import { describe, expect, test } from 'vitest';
import { parseScan } from '../services/clamav-scanner/parse-scan.mjs';

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
  });
});
