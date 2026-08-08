// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkeletonList } from './Skeleton';

describe('SkeletonList', () => {
  test('annonce le chargement et rend le nombre de lignes attendu', () => {
    const { container } = render(<SkeletonList rows={3} label="Chargement des acces" />);

    expect(screen.getByRole('status', { name: 'Chargement des acces' })).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });

  test('neutralise le mouvement quand la preference utilisateur le demande', () => {
    const { container } = render(<SkeletonList rows={2} label="Chargement" />);
    for (const row of container.querySelectorAll('[aria-hidden="true"]')) {
      expect(row).toHaveClass('motion-reduce:animate-none');
    }
  });
});
