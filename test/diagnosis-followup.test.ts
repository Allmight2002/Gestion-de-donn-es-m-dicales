// L56 — enregistrement du socle et suivi des cas non couverts (spec-collecte-diagnostique §4).
//
// Le point de la suite : la BASE decide. Un socle valide avec un diagnostic non couvert doit
// s'enregistrer sans nouveau droit, la file de suivi doit rester fermee a tout autre profil que
// le medecin proprietaire, et aucun agregat ne doit transporter d'identite ni de texte libre.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let alice: string; // medecin proprietaire
let bob: string; // medecin d'une autre base
let editor: string; // collaborateur medecin (acces complet en edition, mais pas proprietaire)
let admin: string; // administrateur systeme
/** Comptes de mission (saisisseur) : un identifiant de mission ne vaut que pour UNE base. */
const missionUsers = new Set<string>();

const HEADERS = `select set_config('request.headers','{"x-meddata-diagnosis-contract":"1"}',false)`;

/** Client authentifie ANNONCANT le contrat L55, comme le fait le frontend a jour. */
function asUser<T>(uid: string, fn: (c: Client) => Promise<T>): Promise<T> {
  return db.asUser(uid, async (c) => { await c.query(HEADERS); return fn(c); },
    missionUsers.has(uid) ? { app_metadata: { mission_credential_generation: 1 } } : undefined);
}
const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  asUser(uid, async (c) => (await c.query(sql, params)).rows);

interface FollowupItem {
  scope: 'patient' | 'encounter';
  patientId: string;
  patientCode: string;
  encounterId: string | null;
  encounterType: string | null;
  encounterDate: string | null;
  status: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  onCurrentVersion: boolean;
  counts: Record<string, number>;
  uncoveredCodes: string[];
  codesCoveredInCurrentVersion: string[];
}
interface FollowupPage {
  items: FollowupItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  unclassifiedRecords: number;
  byCode: { code: string; records: number }[];
  currentVersionId: string | null;
}
const FOLLOWUP = 'select public.diagnosis_followup($1,$2,$3,$4,$5,$6) as f';
const followupAs = async (uid: string, baseId: string, opts: {
  scope?: string | null; versionId?: string | null; code?: string | null; limit?: number; offset?: number;
} = {}): Promise<FollowupPage> =>
  (await rowsAs(uid, FOLLOWUP, [baseId, opts.scope ?? null, opts.versionId ?? null, opts.code ?? null,
    opts.limit ?? 50, opts.offset ?? 0]))[0].f as FollowupPage;

const CREATE_PAT = 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)';
const CREATE_ENC = 'select * from public.create_encounter($1,$2,$3,$4,$5::jsonb,$6)';
const UPDATE_PAT = 'select * from public.update_patient($1,$2::jsonb,$3,$4,$5::bigint)';

/** Associations par defaut : un bloc pour A/D, un second pour D seul, un bloc de rencontre pour A. */
const DEFAULT_RULES = [
  { if: { field: 'diagnostics', operator: 'contains_any', value: ['A', 'D'] }, then: { section: 'bloc', operator: 'visible' } },
  { if: { field: 'diagnostics', operator: 'contains_any', value: ['D'] }, then: { section: 'autre_bloc', operator: 'visible' } },
  { if: { field: 'enc_diag', operator: 'contains_any', value: ['A'] }, then: { section: 'bloc_rencontre', operator: 'visible' } },
];

/** Version complete : socle commun, pilote diagnostique et blocs associes, pour les deux portees.
 *  `patientOnly` reproduit une base TRANSVERSALE, qui ne porte aucune variable de rencontre. */
async function makeVersion(
  templateId: string, versionNumber: number, rules: object[] = DEFAULT_RULES, patientOnly = false,
) {
  const version = (await db.admin.query(
    "insert into template_version(template_id,version_number,status) values($1,$2,'draft') returning id",
    [templateId, versionNumber])).rows[0].id as string;
  await db.admin.query(
    `insert into template_section(template_version_id,section_key,label,display_order)
     values($1,'bloc','Bloc',0),($1,'autre_bloc','Autre bloc',1)`
    + (patientOnly ? '' : ",($1,'bloc_rencontre','Bloc rencontre',2)"),
    [version]);
  await db.admin.query(
    `insert into template_field(template_version_id,field_key,label,scope,section,type,allowed_values,required,display_order)
     values($1,'socle','Socle','patient',null,'text',null,true,0),
     ($1,'diagnostics','Diagnostics','patient',null,'multiselect','["A","B","C","D"]'::jsonb,false,1),
     ($1,'diagnostics_autre','Proposition','patient',null,'text',null,false,2),
     ($1,'mesure','Mesure specialisee','patient','bloc','text',null,true,3),
     ($1,'mesure_bis','Autre mesure','patient','autre_bloc','text',null,true,4)`
    + (patientOnly ? '' : `,
     ($1,'enc_socle','Socle rencontre','encounter',null,'text',null,true,5),
     ($1,'enc_diag','Diagnostics rencontre','encounter',null,'multiselect','["A","B","C","D"]'::jsonb,false,6),
     ($1,'enc_diag_autre','Proposition rencontre','encounter',null,'text',null,false,7),
     ($1,'enc_mesure','Mesure rencontre','encounter','bloc_rencontre','text',null,true,8)`),
    [version]);
  for (const rule of rules) {
    if (patientOnly && (rule as { if: { field: string } }).if.field.startsWith('enc_')) continue;
    await db.admin.query("insert into validation_rule(template_version_id,rule,severity) values($1,$2,'block')", [version, rule]);
  }
  await db.admin.query('update template_version set diagnosis_configuration=$2 where id=$1', [version, JSON.stringify([
    { scope: 'patient', diagnosisFieldKey: 'diagnostics', terminologyReleaseId: null, commonOnlyCodes: ['B'] },
    ...(patientOnly ? [] : [{ scope: 'encounter', diagnosisFieldKey: 'enc_diag', terminologyReleaseId: null, commonOnlyCodes: [] }]),
  ])]);
  await asUser(alice, (c) => c.query('select publish_template_version($1)', [version]));
  return version;
}

/** Base autorisee : gabarit personnel d'Alice, version publiee, mission active pour l'etudiant. */
async function makeBase(name: string, observationModel = 'longitudinal') {
  const templateId = (await db.admin.query(
    "insert into template(name,owner_user_id,is_global) values($1,$2,false) returning id", [name, alice])).rows[0].id as string;
  const version = await makeVersion(templateId, 1, DEFAULT_RULES, observationModel === 'cross_sectional');
  const baseId = (await db.admin.query(
    `insert into base(name,owner_user_id,current_template_version_id,observation_model)
     values($1,$2,$3,$4) returning id`, [name, alice, version, observationModel])).rows[0].id as string;
  return { templateId, version, baseId };
}

/** Compte de mission ACTIF sur une base : profil saisisseur, identifiant gere, acces a echeance. */
async function makeMissionAccount(baseId: string, slug: string): Promise<string> {
  const uid = (await db.admin.query(
    `insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
       raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
     values ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated',
       $1,'x',now(),'{"global_role":"saisisseur"}'::jsonb,'{}'::jsonb,now(),now())
     returning id`, [`${slug}@demo.test`])).rows[0].id as string;
  missionUsers.add(uid);
  await db.admin.query(
    `insert into mission_account_credential (user_id,base_id,owner_user_id,account_label,login_identifier,
       password_ciphertext,password_nonce,credential_generation,status)
     values ($1,$2,$3,'Compte de mission L56',$4,'chiffrement-fictif-non-secret','nonce-fictif-non-secret',1,'active')`,
    [uid, baseId, alice, slug]);
  await rowsAs(alice, "select provision_mission_access($1,$2,now() + interval '12 months',false,null)", [baseId, uid]);
  return uid;
}

const SOCLE = { socle: 'valeur fictive' };
const ENC_SOCLE = { enc_socle: 'valeur fictive' };

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = new Map<string, string>(
    (await db.admin.query('select email,id from auth.users')).rows.map((r) => [r.email, r.id]));
  alice = users.get('alice@demo.test')!;
  bob = users.get('bob@demo.test')!;
  editor = users.get('editor@demo.test')!;
  admin = users.get('admin@demo.test')!;
}, 240_000);

afterAll(async () => { await db?.stop(); });

describe('L56 enregistrement du socle', () => {
  test('socle valide + diagnostic non couvert : enregistrable, y compris en compte de mission', async () => {
    const { baseId } = await makeBase('L56 saisie');
    const student = await makeMissionAccount(baseId, 'l56-saisie');

    // Le compte de mission ne peut PAS ouvrir de brouillon partiel : la fiche est donc
    // enregistree complete. Un diagnostic non couvert n'invente aucune variable requise --
    // le bloc specialise est masque, donc `mesure` n'est jamais reclamee.
    const patient = (await rowsAs(student, CREATE_PAT, [baseId, 'L56-001', null, null, null, null, null,
      JSON.stringify({ ...SOCLE, diagnostics: ['C'] })]))[0];
    expect(patient.validation_status).toBe('draft');
    const enc = (await rowsAs(student, CREATE_ENC, [patient.id, 'consultation', '2026-03-01', 'complete',
      JSON.stringify({ ...ENC_SOCLE, enc_diag: ['C'] }), 'years']))[0];
    expect(enc.validation_status).toBe('complete');

    // Cas MIXTE : l'absence d'un bloc ne dispense pas de completer l'autre bloc applicable.
    await expect(rowsAs(student, CREATE_PAT, [baseId, 'L56-002', null, null, null, null, null,
      JSON.stringify({ ...SOCLE, diagnostics: ['A', 'C'] })])).rejects.toThrow('Champ requis manquant');
    const mixte = (await rowsAs(student, CREATE_PAT, [baseId, 'L56-003', null, null, null, null, null,
      JSON.stringify({ ...SOCLE, diagnostics: ['A', 'C'], mesure: 'valeur fictive' })]))[0];
    expect(mixte.data.mesure).toBe('valeur fictive');

    // Le socle, lui, reste exige : le mode ne rend aucun champ commun facultatif.
    await expect(rowsAs(student, CREATE_PAT, [baseId, 'L56-004', null, null, null, null, null,
      JSON.stringify({ diagnostics: ['C'] })])).rejects.toThrow('Champ requis manquant');

    // Aucun droit nouveau : ni identite, ni curation, ni correction d'une fiche soumise.
    await expect(rowsAs(student, CREATE_PAT, [baseId, 'L56-005', 'Nom fictif', '1990-01-01', null, null, null,
      JSON.stringify({ ...SOCLE, diagnostics: ['C'] })])).rejects.toThrow('identite');
    await expect(rowsAs(student, UPDATE_PAT, [mixte.id, JSON.stringify({ ...SOCLE, diagnostics: ['C'] }),
      'curated', 'motif fictif', mixte.row_version])).rejects.toThrow('Acces refuse');
  });

  test('proposition hors liste enregistrable, et ancien client refuse sans mode permissif', async () => {
    const { baseId } = await makeBase('L56 proposition');
    const patient = (await rowsAs(alice, CREATE_PAT, [baseId, 'L56-P1', null, null, null, null, null,
      JSON.stringify({ ...SOCLE, diagnostics_autre: 'Diagnostic fictif hors liste' })]))[0];
    expect(patient.data.diagnostics_autre).toBe('Diagnostic fictif hors liste');

    // Un client qui n'annonce pas le contrat L55 est refuse a la soumission, jamais tolere.
    await expect(db.asUser(alice, (c) => c.query(CREATE_PAT,
      [baseId, 'L56-P2', null, null, null, null, null, JSON.stringify({ ...SOCLE, diagnostics: ['C'] })])))
      .rejects.toThrow('Actualisez');
  });

  test('retrait de diagnostic : refus serveur, conflit de version, et valeurs conservees', async () => {
    const { baseId } = await makeBase('L56 retrait');
    const patient = (await rowsAs(alice, CREATE_PAT, [baseId, 'L56-R1', null, null, null, null, null,
      JSON.stringify({ ...SOCLE, diagnostics: ['A'], mesure: 'valeur fictive' })]))[0];

    // Retirer le diagnostic SANS retirer la valeur du bloc masque : refus explicite cote base.
    await expect(rowsAs(alice, UPDATE_PAT, [patient.id,
      JSON.stringify({ ...SOCLE, diagnostics: ['C'], mesure: 'valeur fictive' }), 'draft', 'motif fictif',
      patient.row_version])).rejects.toThrow('bloc masque');
    // Annulation cote ecran : rien n'a ete envoye, la fiche est intacte.
    const untouched = (await rowsAs(alice, 'select data from patient where id=$1', [patient.id]))[0];
    expect(untouched.data).toEqual({ ...SOCLE, diagnostics: ['A'], mesure: 'valeur fictive' });

    // Confirmation : diagnostic ET valeurs du bloc partent ensemble.
    const confirmed = (await rowsAs(alice, UPDATE_PAT, [patient.id,
      JSON.stringify({ ...SOCLE, diagnostics: ['C'] }), 'draft', 'motif fictif', patient.row_version]))[0];
    expect(confirmed.data).toEqual({ ...SOCLE, diagnostics: ['C'] });

    // Conflit : un jeton perime ne peut pas ecraser le travail d'autrui.
    await expect(rowsAs(alice, UPDATE_PAT, [patient.id, JSON.stringify({ ...SOCLE, diagnostics: ['B'] }),
      'draft', 'motif fictif', patient.row_version])).rejects.toThrow('CONFLIT_VERSION');
  });
});

describe('L56 file de suivi', () => {
  test('couvert, non couvert, proposition, mixte, plusieurs blocs et second diagnostic', async () => {
    const { baseId, version } = await makeBase('L56 file');
    const create = async (code: string, data: object) =>
      (await rowsAs(alice, CREATE_PAT, [baseId, code, null, null, null, null, null, JSON.stringify(data)]))[0];

    const couvert = await create('F-01', { ...SOCLE, diagnostics: ['A'], mesure: 'valeur fictive' });
    const socleSuffit = await create('F-02', { ...SOCLE, diagnostics: ['B'] });
    await create('F-03', { ...SOCLE, diagnostics: ['C'] });
    await create('F-04', { ...SOCLE, diagnostics_autre: 'Texte fictif de proposition' });
    await create('F-05', { ...SOCLE, diagnostics: ['A', 'C'], mesure: 'valeur fictive' });
    await create('F-06', { ...SOCLE, diagnostics: ['D'], mesure: 'valeur fictive', mesure_bis: 'valeur fictive' });

    // Meme patient, deux rencontres : l'une couverte, l'autre non.
    await rowsAs(alice, CREATE_ENC, [couvert.id, 'consultation', '2026-03-01', 'complete',
      JSON.stringify({ ...ENC_SOCLE, enc_diag: ['A'], enc_mesure: 'valeur fictive' }), 'years']);
    await rowsAs(alice, CREATE_ENC, [couvert.id, 'suivi', '2026-04-01', 'complete',
      JSON.stringify({ ...ENC_SOCLE, enc_diag: ['C'] }), 'years']);

    const page = await followupAs(alice, baseId);
    const codes = page.items.map((i) => `${i.patientCode}:${i.scope}`);
    // Couvert, socle suffisant et double bloc restent HORS de la file ; l'absence de
    // diagnostic n'y entre pas non plus (F-01 patient est couvert, pas vide).
    expect(codes).toEqual(['F-01:encounter', 'F-03:patient', 'F-04:patient', 'F-05:patient']);
    expect(page.total).toBe(4);
    expect(page.items.find((i) => i.patientCode === 'F-05')!.counts)
      .toEqual({ covered: 1, common_only: 0, uncovered: 1, unclassified: 0 });
    expect(page.items.find((i) => i.patientCode === 'F-04')!.uncoveredCodes).toEqual([]);
    expect(page.items.find((i) => i.patientCode === 'F-04')!.counts.unclassified).toBe(1);
    expect(page.unclassifiedRecords).toBe(1);
    expect(page.byCode).toEqual([{ code: 'C', records: 3 }]);
    expect(page.items.every((i) => i.onCurrentVersion)).toBe(true);
    expect(page.currentVersionId).toBe(version);

    // Le socle suffisant est une DECISION, pas un oubli : F-02 n'apparait nulle part.
    expect(page.items.some((i) => i.patientCode === socleSuffit.patient_code)).toBe(false);

    // Aucune identite, aucun document, aucun texte libre : les items ne portent que des
    // codes, des identifiants techniques et des comptes.
    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain('Texte fictif de proposition');
    expect(serialized).not.toContain('valeur fictive');
    expect(Object.keys(page.items[0]!).sort()).toEqual([
      'codesCoveredInCurrentVersion', 'counts', 'encounterDate', 'encounterId', 'encounterType',
      'onCurrentVersion', 'patientCode', 'patientId', 'scope', 'sourceVersionId',
      'sourceVersionNumber', 'status', 'uncoveredCodes',
    ]);
  });

  test('filtres portee/version/code, pagination, et exclusion des lignes supprimees', async () => {
    const { baseId } = await makeBase('L56 filtres');
    const p1 = (await rowsAs(alice, CREATE_PAT, [baseId, 'G-01', null, null, null, null, null,
      JSON.stringify({ ...SOCLE, diagnostics: ['C'] })]))[0];
    const p2 = (await rowsAs(alice, CREATE_PAT, [baseId, 'G-02', null, null, null, null, null,
      JSON.stringify({ ...SOCLE, diagnostics: ['B', 'C'] })]))[0];
    const enc = (await rowsAs(alice, CREATE_ENC, [p1.id, 'consultation', '2026-03-01', 'complete',
      JSON.stringify({ ...ENC_SOCLE, enc_diag: ['D'] }), 'years']))[0];

    expect((await followupAs(alice, baseId)).total).toBe(3);
    expect((await followupAs(alice, baseId, { scope: 'patient' })).items.map((i) => i.patientCode)).toEqual(['G-01', 'G-02']);
    expect((await followupAs(alice, baseId, { scope: 'encounter' })).items.map((i) => i.scope)).toEqual(['encounter']);
    expect((await followupAs(alice, baseId, { code: 'C' })).total).toBe(2);
    expect((await followupAs(alice, baseId, { code: 'D' })).items.map((i) => i.encounterId)).toEqual([enc.id]);
    expect((await followupAs(alice, baseId, { code: 'B' })).total).toBe(0); // socle suffisant : jamais liste
    await expect(followupAs(alice, baseId, { scope: 'inconnu' })).rejects.toThrow('Portee de suivi inconnue');

    const first = await followupAs(alice, baseId, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.total).toBe(3);
    expect(first.hasMore).toBe(true);
    const last = await followupAs(alice, baseId, { limit: 1, offset: 2 });
    expect(last.hasMore).toBe(false);
    expect(last.items[0]!.patientCode).toBe('G-02');

    // Lignes supprimees : ni le patient, ni sa rencontre ne subsistent dans la file.
    await rowsAs(alice, 'select soft_delete_patient($1,$2)', [p1.id, 'motif fictif']);
    const afterDelete = await followupAs(alice, baseId);
    expect(afterDelete.items.map((i) => i.patientCode)).toEqual(['G-02']);
    expect(afterDelete.byCode).toEqual([{ code: 'C', records: 1 }]);
    expect(p2.id).toBeTruthy();

    // Base supprimee : la file se ferme avec elle.
    await db.admin.query("update base set deleted_at=now() where id=$1", [baseId]);
    await expect(followupAs(alice, baseId)).rejects.toThrow('Reserve au medecin proprietaire');
  });

  test('dossier historique : couverture de la version SOURCE, evolution seulement signalee', async () => {
    const { baseId, templateId, version } = await makeBase('L56 historique');
    const historique = (await rowsAs(alice, CREATE_PAT, [baseId, 'H-01', null, null, null, null, null,
      JSON.stringify({ ...SOCLE, diagnostics: ['C'] })]))[0];

    // Nouvelle version : le responsable associe enfin un bloc au code C. Une association
    // canonique = UNE regle par bloc : la version 2 remplace celle de `autre_bloc`.
    const v2 = await makeVersion(templateId, 2, [
      { if: { field: 'diagnostics', operator: 'contains_any', value: ['A', 'D'] }, then: { section: 'bloc', operator: 'visible' } },
      { if: { field: 'diagnostics', operator: 'contains_any', value: ['C'] }, then: { section: 'autre_bloc', operator: 'visible' } },
      { if: { field: 'enc_diag', operator: 'contains_any', value: ['A'] }, then: { section: 'bloc_rencontre', operator: 'visible' } },
    ]);
    await rowsAs(alice, 'update base set current_template_version_id=$2 where id=$1', [baseId, v2]);

    const page = await followupAs(alice, baseId);
    // Publier un bloc ne retire PAS le dossier historique de la file et n'annonce aucune reprise.
    expect(page.items.map((i) => i.patientCode)).toEqual(['H-01']);
    const item = page.items[0]!;
    expect(item.sourceVersionId).toBe(version);
    expect(item.sourceVersionNumber).toBe(1);
    expect(item.onCurrentVersion).toBe(false);
    expect(item.uncoveredCodes).toEqual(['C']);
    // ... mais l'evolution du gabarit est SIGNALEE, distinctement de la version source.
    expect(item.codesCoveredInCurrentVersion).toEqual(['C']);
    expect(page.currentVersionId).toBe(v2);
    expect(historique.template_version_id).toBe(version);

    // Filtrer sur la version source reste possible ; la version courante ne la remplace pas.
    expect((await followupAs(alice, baseId, { versionId: version })).total).toBe(1);
    expect((await followupAs(alice, baseId, { versionId: v2 })).total).toBe(0);
  });

  test('transversal : le refus des rencontres tient, la file reste celle des patients', async () => {
    const { baseId } = await makeBase('L56 transversal', 'cross_sectional');
    const p = (await rowsAs(alice, CREATE_PAT, [baseId, 'T-01', null, null, null, null, null,
      JSON.stringify({ ...SOCLE, diagnostics: ['C'] })]))[0];
    await expect(rowsAs(alice, CREATE_ENC, [p.id, 'consultation', '2026-03-01', 'draft',
      '{}', 'years'])).rejects.toThrow('transversale');
    const page = await followupAs(alice, baseId);
    expect(page.items.map((i) => i.scope)).toEqual(['patient']);
    expect((await followupAs(alice, baseId, { scope: 'encounter' })).total).toBe(0);
  });

  test('base sans configuration diagnostique : file vide, comportement historique intact', async () => {
    const templateId = (await db.admin.query(
      "insert into template(name,owner_user_id,is_global) values('L56 sans config',$1,false) returning id", [alice])).rows[0].id;
    const version = (await db.admin.query(
      "insert into template_version(template_id,version_number,status) values($1,1,'draft') returning id", [templateId])).rows[0].id;
    await db.admin.query(
      `insert into template_field(template_version_id,field_key,label,scope,section,type,required,display_order)
       values($1,'socle','Socle','patient',null,'text',true,0)`, [version]);
    await asUser(alice, (c) => c.query('select publish_template_version($1)', [version]));
    const baseId = (await db.admin.query(
      'insert into base(name,owner_user_id,current_template_version_id) values($1,$2,$3) returning id',
      ['L56 sans config', alice, version])).rows[0].id;
    // Aucun en-tete de contrat requis : une base historique reste saisissable par un client ancien.
    await db.asUser(alice, (c) => c.query(CREATE_PAT,
      [baseId, 'N-01', null, null, null, null, null, JSON.stringify(SOCLE)]));
    const page = await followupAs(alice, baseId);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.byCode).toEqual([]);
  });
});

describe('L56 refus serveurs directs', () => {
  test('la file n appartient qu au medecin proprietaire, meme en appel direct', async () => {
    const { baseId } = await makeBase('L56 acces');
    await rowsAs(alice, CREATE_PAT, [baseId, 'A-01', null, null, null, null, null,
      JSON.stringify({ ...SOCLE, diagnostics: ['C'] })]);

    // Collaborateur medecin avec TOUTES les permissions d'edition : la vue transversale
    // n'est pas une permission de base, elle appartient au proprietaire.
    await db.admin.query(
      `insert into base_access(base_id,user_id,access_role,can_view_identity,can_view_raw_documents,
         can_edit_structured_data,can_export_data,can_manage_access,granted_by)
       values($1,$2,'editor',true,true,true,true,true,$3)`, [baseId, editor, alice]);
    expect((await rowsAs(editor, 'select id from patient where base_id=$1', [baseId])).length).toBe(1);
    await expect(followupAs(editor, baseId)).rejects.toThrow('Reserve au medecin proprietaire');

    // Compte de mission : il saisit, il ne recoit jamais une file de patients supplementaire.
    const student = await makeMissionAccount(baseId, 'l56-acces');
    await expect(followupAs(student, baseId)).rejects.toThrow('Reserve au medecin proprietaire');

    // Administrateur systeme : aucune vue clinique transversale.
    await expect(followupAs(admin, baseId)).rejects.toThrow('Reserve au medecin proprietaire');
    // Utilisateur d'une autre base.
    await expect(followupAs(bob, baseId)).rejects.toThrow('Reserve au medecin proprietaire');
  });

  test('mission expiree ou revoquee : ni saisie, ni file', async () => {
    const { baseId } = await makeBase('L56 expiration');
    const student = await makeMissionAccount(baseId, 'l56-exp');
    await rowsAs(student, CREATE_PAT, [baseId, 'E-01', null, null, null, null, null,
      JSON.stringify({ ...SOCLE, diagnostics: ['C'] })]);

    await db.admin.query("update base_access set expires_at = now() - interval '1 day' where base_id=$1 and user_id=$2", [baseId, student]);
    await expect(rowsAs(student, CREATE_PAT, [baseId, 'E-02', null, null, null, null, null,
      JSON.stringify({ ...SOCLE, diagnostics: ['C'] })])).rejects.toThrow('Acces refuse');
    await expect(followupAs(student, baseId)).rejects.toThrow('Reserve au medecin proprietaire');

    await db.admin.query("update base_access set expires_at = null, revoked_at = now() where base_id=$1 and user_id=$2", [baseId, student]);
    await expect(rowsAs(student, CREATE_PAT, [baseId, 'E-03', null, null, null, null, null,
      JSON.stringify({ ...SOCLE, diagnostics: ['C'] })])).rejects.toThrow('Acces refuse');
    await expect(followupAs(student, baseId)).rejects.toThrow('Reserve au medecin proprietaire');
  });
});
