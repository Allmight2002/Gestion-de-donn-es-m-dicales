import { describe, expect, test } from 'vitest';
import { parseScan } from '../services/clamav-scanner/parse-scan.mjs';
import { parseClamavVersion } from '../services/clamav-scanner/parse-version.mjs';

describe('parseScan ClamAV bridge', () => {
  test('classe les signatures FOUND avant tout OK contenu dans le nom', () => {
    expect(parseScan('stream: Eicar-Test-Signature FOUND')).toMatchObject({
      status: 'infected',
      signature: 'Eicar-Test-Signature',
    });
    expect(parseScan('stream: Foo.OK.Bar FOUND')).toMatchObject({
      status: 'infected',
      signature: 'Foo.OK.Bar',
    });
  });

  test('n accepte comme propre que la reponse stream: OK exacte', () => {
    expect(parseScan('stream: OK')).toMatchObject({ status: 'clean' });
    expect(parseScan('stream: Something OK-ish')).toMatchObject({ status: 'error' });
    expect(parseScan('stream: Something ERROR')).toMatchObject({ status: 'error' });
    expect(parseScan('stream: internal detail ERROR')).not.toHaveProperty('raw');
  });
});

describe('parseClamavVersion', () => {
  test('extrait uniquement la version moteur et la fraicheur de la base de signatures', () => {
    const databaseDate = 'Fri Jul 18 09:37:00 2026';
    expect(parseClamavVersion(`ClamAV 1.5.1/27896/${databaseDate}\0`))
      .toEqual({
        engineVersion: '1.5.1',
        signatureDatabaseVersion: '27896',
        signatureDatabaseUpdatedAt: new Date(Date.parse(databaseDate)).toISOString(),
      });
  });

  test('refuse une reponse indisponible ou non interpretable', () => {
    expect(parseClamavVersion('COMMAND UNAVAILABLE')).toBeNull();
    expect(parseClamavVersion('ClamAV 1.5.1/not-a-version/not-a-date')).toBeNull();
  });
});
