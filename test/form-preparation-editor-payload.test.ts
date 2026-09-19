// =============================================================================
// E4 — fidelite du payload produit par l'editeur de preparation.
//
// L'ecran E4 edite un CANDIDAT structurel puis l'envoie aux RPC E1/E2. Le serveur
// compare ce candidat a la definition source objet par objet : toute cle en trop,
// toute cle manquante et toute valeur reconstruite differemment comptent comme une
// modification, donc comme un changement semantique refuse.
//
// Ces tests exercent la vraie chaine : definition rendue par
// `open_or_resume_form_preparation`, serialisation par l'adaptateur E4, puis
// `save_form_preparation` / `preview_form_preparation` / `apply_form_preparation`
// sur un PostgreSQL embarque. Aucun objet serveur n'est simule.
// =============================================================================
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';
import {
  createPreparationTemplateRepository,
  type PreparationEditorLoaded,
} from '../src/domain/formPreparationEditor.js';
import { templateFieldToNewField } from '../src/domain/templateFields.js';
import type { FormDefinition } from '../src/data/formPreparations.js';

let db: TestDb;
let aliceId: string;

interface Fixture {
  templateId: string;
  versionId: string;
  baseId: string;
}

interface Impact {
  serverCounts: { patients: number; encounters: number };
  addedFields: Array<Record<string, unknown>>;
  addedSections: Array<Record<string, unknown>>;
  addedCommonGroups: Array<Record<string, unknown>>;
  addedRules: Array<Record<string, unknown>>;
  addedDiagnosisAssociations: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface Receipt {
  preparation: { classification: string; state: string; preparationRevision: number; [key: string]: unknown };
  impact?: Impact;
  application?: { targetTemplateVersionId: string; [key: string]: unknown };
  error?: string;
  code?: string;
  [key: string]: unknown;
}

const DIAGNOSIS_HEADERS = `select set_config('request.headers','{"x-meddata-diagnosis-contract":"1"}',true)`;

async function rpc<T>(sql: string, params: unknown[]): Promise<T> {
  return db.asUser(aliceId, async (client) => {
    await client.query(DIAGNOSIS_HEADERS);
    return (await client.query(sql, params)).rows[0].result as T;
  });
}

async function createFixture(): Promise<Fixture> {
  const templateId = randomUUID();
  const versionId = randomUUID();
  const rootSectionId = randomUUID();
  const childSectionId = randomUUID();
  const groupId = randomUUID();
  const baseId = randomUUID();

  await db.admin.query('begin');
  try {
    await db.admin.query("select set_config('app.setting_common_layout','on',true)");
    await db.admin.query(
      `insert into public.template(id,name,specialty,owner_user_id,is_global) values($1,$2,'e4-test',null,true)`,
      [templateId, `E4 source ${templateId.slice(0, 8)}`],
    );
    await db.admin.query(
      `insert into public.template_version(id,template_id,version_number,status,created_by) values($1,$2,1,'published',$3)`,
      [versionId, templateId, aliceId],
    );
    await db.admin.query(
      `insert into public.template_section(id,template_version_id,section_key,label,display_order)
       values($1,$3,'clinique','Clinique',0),($2,$3,'imagerie','Imagerie',1)`,
      [rootSectionId, childSectionId, versionId],
    );
    await db.admin.query(
      'update public.template_section set parent_section_id=$1 where id=$2',
      [rootSectionId, childSectionId],
    );
    await db.admin.query(
      `insert into public.template_common_group(id,template_version_id,group_key,label,display_order,anchor_order,is_default)
       values($1,$2,'contexte','Contexte',0,0,true)`,
      [groupId, versionId],
    );
    // Quatre variables choisies pour couvrir les formes qui se reconstruisent mal :
    // options riches L30, liste historique par cles, variable commune UX-16 et
    // variable de rencontre avec unite, bornes et raisons de valeur manquante.
    await db.admin.query(
      `insert into public.template_field(
         template_version_id,field_key,label,description,default_value,scope,section,section_id,type,
         is_multiple,unit,allowed_values,allowed_options,required,min_value,max_value,
         allow_missing_codes,missing_reasons,formula,display_order,encounter_types,common_group_id
       ) values
        ($1,'lateralite','Latéralité','Côté opéré',null,'patient','clinique',$2,'select',
         false,null,'["gauche","droite"]'::jsonb,
         '[{"value_key":"gauche","label":"Gauche","is_active":true},{"value_key":"droite","label":"Droite","is_active":true}]'::jsonb,
         false,null,null,true,array['non_fait','inconnu','non_applicable']::text[],null,0,null,null),
        ($1,'grade','Grade','Grade histologique',null,'patient','clinique',$2,'select',
         false,null,'["I","II","III"]'::jsonb,null,
         false,null,null,true,array['non_fait','inconnu','non_applicable']::text[],null,1,null,null),
        ($1,'centre','Centre inclueur',null,null,'patient',null,null,'text',
         false,null,null,null,false,null,null,true,array['non_fait','inconnu','non_applicable']::text[],null,2,null,$3),
        ($1,'poids','Poids','Poids mesuré le jour de la rencontre',null,'encounter','imagerie',$4,'number',
         false,'kg',null,null,false,0,400,true,array['non_fait','inconnu','non_applicable']::text[],null,3,
         array['consultation','suivi']::text[],null)`,
      [versionId, rootSectionId, groupId, childSectionId],
    );
    await db.admin.query(
      `insert into public.validation_rule(template_version_id,rule,message,severity) values($1,$2::jsonb,$3,'block')`,
      [
        versionId,
        JSON.stringify({
          if: { field: 'lateralite', operator: 'equals', value: 'gauche' },
          then: { field: 'grade', operator: 'required' },
        }),
        'Le grade est requis à gauche',
      ],
    );
    await db.admin.query(
      `insert into public.base(id,name,specialty,owner_user_id,current_template_version_id)
       values($1,'Base E4','e4-test',$2,$3)`,
      [baseId, aliceId, versionId],
    );
    await db.admin.query(
      `insert into public.patient(id,base_id,patient_code,template_version_id,data,collection_mode,validation_status,created_by)
       values($1,$2,'E4-001',$3,'{"lateralite":"gauche","grade":"II"}'::jsonb,'direct','draft',$4)`,
      [randomUUID(), baseId, versionId, aliceId],
    );
    await db.admin.query('commit');
  } catch (error) {
    await db.admin.query('rollback');
    throw error;
  }
  return { templateId, versionId, baseId };
}

async function readContext(fixture: Fixture): Promise<{
  sourceRevision: number;
  sourceFingerprint: string;
  definition: FormDefinition;
}> {
  const result = await rpc<{
    context: { sourceRevision: number; sourceFingerprint: string; definition: FormDefinition };
  }>('select public.open_or_resume_form_preparation($1) as result', [fixture.baseId]);
  return {
    sourceRevision: Number(result.context.sourceRevision),
    sourceFingerprint: String(result.context.sourceFingerprint),
    definition: JSON.parse(JSON.stringify(result.context.definition)) as FormDefinition,
  };
}

function editorSource(fixture: Fixture): PreparationEditorLoaded {
  // Metadonnees que l'ecran obtient de `templates.getVersion` ; la definition
  // structurelle testee vient bien du serveur, pas d'ici.
  return {
    version: {
      id: fixture.versionId,
      templateId: fixture.templateId,
      versionNumber: 1,
      status: 'published',
      diagnosisConfiguration: [],
      diagnosisContext: [],
    },
    fields: [],
    rules: [],
    sections: [],
  };
}

interface Session {
  preparationId: string;
  sourceRevision: number;
  sourceFingerprint: string;
  revision: number;
}

async function saveAndPreview(
  session: Session,
  fixture: Fixture,
  payload: FormDefinition,
): Promise<{ saved: Receipt; preview: Receipt }> {
  const saved = await rpc<Receipt>(
    'select public.save_form_preparation($1,$2,$3,$4,$5,$6,$7::jsonb) as result',
    [session.preparationId, fixture.baseId, session.revision, session.sourceRevision,
      session.sourceFingerprint, randomUUID(), JSON.stringify(payload)],
  );
  session.revision = Number(saved.preparation.preparationRevision);
  const preview = await rpc<Receipt>(
    'select public.preview_form_preparation($1,$2,$3,$4,$5) as result',
    [session.preparationId, session.revision, session.sourceRevision,
      session.sourceFingerprint, randomUUID()],
  );
  if (preview.preparation) session.revision = Number(preview.preparation.preparationRevision);
  return { saved, preview };
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const ids = new Map<string, string>(
    (await db.admin.query('select email,id from auth.users')).rows.map((row) => [row.email, row.id]),
  );
  aliceId = ids.get('alice@demo.test')!;
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('E4 — payload de l’éditeur de préparation', () => {
  test('un candidat ouvert puis non modifié ne déclare aucun changement', async () => {
    const fixture = await createFixture();
    const context = await readContext(fixture);
    const adapter = createPreparationTemplateRepository(editorSource(fixture), context.definition);

    const session: Session = {
      preparationId: randomUUID(),
      sourceRevision: context.sourceRevision,
      sourceFingerprint: context.sourceFingerprint,
      revision: 0,
    };
    const { preview } = await saveAndPreview(session, fixture, adapter.getPreparationPayload());

    // Sans cette fidélité, chaque ouverture de l’éditeur serait classée « sémantique »
    // et aucune évolution, même purement additive, ne pourrait être appliquée.
    expect(preview.error).toBeUndefined();
    expect(preview.preparation.classification).toBe('additive');
    expect(preview.preparation.state).toBe('ready');
    const impact = preview.impact!;
    expect(impact.addedFields).toEqual([]);
    expect(impact.addedSections).toEqual([]);
    expect(impact.addedCommonGroups).toEqual([]);
    expect(impact.addedRules).toEqual([]);
    expect(impact.addedDiagnosisAssociations).toEqual([]);
    expect(impact.serverCounts.patients).toBe(1);
  }, 120_000);

  test('réenregistrer une variable sans la modifier ne déclare toujours aucun changement', async () => {
    const fixture = await createFixture();
    const context = await readContext(fixture);
    const adapter = createPreparationTemplateRepository(editorSource(fixture), context.definition);

    // Le chemin d'écriture réel de l'éditeur : la variable lue repart entière vers le dépôt.
    const loaded = await adapter.getVersion(fixture.versionId);
    for (const field of loaded.fields) {
      await adapter.updateField(field.id, templateFieldToNewField(field));
    }

    const session: Session = {
      preparationId: randomUUID(),
      sourceRevision: context.sourceRevision,
      sourceFingerprint: context.sourceFingerprint,
      revision: 0,
    };
    const { preview } = await saveAndPreview(session, fixture, adapter.getPreparationPayload());

    expect(preview.error).toBeUndefined();
    expect(preview.preparation.classification).toBe('additive');
    expect(preview.impact!.addedFields).toEqual([]);
  }, 120_000);

  test('renommer une variable et son bloc reste une évolution compatible, appliquée sans perte', async () => {
    const fixture = await createFixture();
    const context = await readContext(fixture);
    const adapter = createPreparationTemplateRepository(editorSource(fixture), context.definition);

    const loaded = await adapter.getVersion(fixture.versionId);
    const grade = loaded.fields.find((field) => field.fieldKey === 'grade')!;
    await adapter.updateField(grade.id, templateFieldToNewField(grade, { label: 'Grade révisé' }));
    const imagerie = loaded.sections.find((section) => section.sectionKey === 'imagerie')!;
    await adapter.renameSection!(imagerie.id, 'Imagerie révisée');

    const session: Session = {
      preparationId: randomUUID(),
      sourceRevision: context.sourceRevision,
      sourceFingerprint: context.sourceFingerprint,
      revision: 0,
    };
    const { preview } = await saveAndPreview(session, fixture, adapter.getPreparationPayload());

    // Le classifieur E1 durci traite libellé, description, section et options comme de la
    // présentation. C'est précisément ce que E4 promet au responsable : corriger un libellé
    // sans créer de version ni de base.
    expect(preview.error).toBeUndefined();
    expect(preview.preparation.classification).toBe('additive');
    expect(preview.impact!.addedFields).toEqual([]);
    expect(preview.impact!.addedSections).toEqual([]);

    const applied = await rpc<Receipt>(
      'select public.apply_form_preparation($1,$2,$3,$4,$5) as result',
      [session.preparationId, session.revision, session.sourceRevision,
        session.sourceFingerprint, randomUUID()],
    );
    expect(applied.error).toBeUndefined();
    const targetVersionId = applied.application!.targetTemplateVersionId;
    const label = (await db.admin.query(
      'select label from public.template_field where template_version_id=$1 and field_key=$2',
      [targetVersionId, 'grade'],
    )).rows[0].label as string;
    expect(label).toBe('Grade révisé');
    const sectionLabel = (await db.admin.query(
      'select label from public.template_section where template_version_id=$1 and section_key=$2',
      [targetVersionId, 'imagerie'],
    )).rows[0].label as string;
    expect(sectionLabel).toBe('Imagerie révisée');
    const patient = (await db.admin.query(
      'select data from public.patient where base_id=$1', [fixture.baseId],
    )).rows[0].data as Record<string, unknown>;
    expect(patient).toEqual({ lateralite: 'gauche', grade: 'II' });
  }, 120_000);

  test('ajouter une variable par l’éditeur reste additif et l’application conserve la structure', async () => {
    const fixture = await createFixture();
    const context = await readContext(fixture);
    const adapter = createPreparationTemplateRepository(editorSource(fixture), context.definition);

    await adapter.addField(fixture.versionId, {
      fieldKey: 'delai_avant_chirurgie',
      label: 'Délai avant chirurgie',
      scope: 'patient',
      section: 'clinique',
      type: 'integer',
      required: false,
      unit: 'jours',
    });

    const session: Session = {
      preparationId: randomUUID(),
      sourceRevision: context.sourceRevision,
      sourceFingerprint: context.sourceFingerprint,
      revision: 0,
    };
    const { preview } = await saveAndPreview(session, fixture, adapter.getPreparationPayload());

    expect(preview.error).toBeUndefined();
    expect(preview.preparation.classification).toBe('additive');
    const impact = preview.impact!;
    expect(impact.addedFields.map((field) => field.fieldKey)).toEqual(['delai_avant_chirurgie']);
    expect(impact.addedSections).toEqual([]);
    expect(impact.addedRules).toEqual([]);
    expect(impact.addedCommonGroups).toEqual([]);

    const applied = await rpc<Receipt>(
      'select public.apply_form_preparation($1,$2,$3,$4,$5) as result',
      [session.preparationId, session.revision, session.sourceRevision,
        session.sourceFingerprint, randomUUID()],
    );
    expect(applied.error).toBeUndefined();
    expect(applied.preparation.state).toBe('applied');

    const targetVersionId = applied.application!.targetTemplateVersionId;
    const fields = (await db.admin.query(
      'select field_key, section, unit, allowed_options, common_group_id from public.template_field where template_version_id=$1 order by display_order, field_key',
      [targetVersionId],
    )).rows as Array<Record<string, unknown>>;
    expect(fields.map((row) => row.field_key).sort()).toEqual(
      ['centre', 'delai_avant_chirurgie', 'grade', 'lateralite', 'poids'],
    );
    // Les options riches et la rubrique commune ne doivent pas disparaitre dans la copie.
    expect(fields.find((row) => row.field_key === 'lateralite')!.allowed_options).not.toBeNull();
    expect(fields.find((row) => row.field_key === 'centre')!.common_group_id).not.toBeNull();

    const sections = (await db.admin.query(
      'select section_key from public.template_section where template_version_id=$1 order by display_order',
      [targetVersionId],
    )).rows.map((row) => row.section_key as string);
    expect(sections).toEqual(['clinique', 'imagerie']);
    const rules = (await db.admin.query(
      'select count(*)::int as total from public.validation_rule where template_version_id=$1',
      [targetVersionId],
    )).rows[0].total as number;
    expect(rules).toBe(1);

    // La base A pointe sur la nouvelle définition sans qu’aucune fiche n’ait été réécrite.
    const base = (await db.admin.query(
      'select current_template_version_id from public.base where id=$1', [fixture.baseId],
    )).rows[0].current_template_version_id as string;
    expect(base).toBe(targetVersionId);
    const patient = (await db.admin.query(
      'select data, template_version_id from public.patient where base_id=$1', [fixture.baseId],
    )).rows[0] as { data: Record<string, unknown>; template_version_id: string };
    expect(patient.data).toEqual({ lateralite: 'gauche', grade: 'II' });
    expect(patient.template_version_id).toBe(fixture.versionId);
  }, 120_000);
});
