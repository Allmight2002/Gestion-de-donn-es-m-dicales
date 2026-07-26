// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import {
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router';

const suspiciousDestinations = [
  '//target',
  String.raw`\\target`,
  String.raw`/\target`,
  String.raw`\/target`,
] as const;

function NavigationTrigger({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>Naviguer</button>;
}

function CurrentPath() {
  const location = useLocation();
  return <output aria-label="chemin courant">{location.pathname}</output>;
}

describe('securite des navigations internes', () => {
  test.each(suspiciousDestinations)('normalise les separateurs ambigus dans %s', async (to) => {
    render(
      <MemoryRouter initialEntries={['/start']}>
        <Routes>
          <Route path="/start" element={<NavigationTrigger to={to} />} />
          <Route path="*" element={<CurrentPath />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Naviguer' }));

    expect(await screen.findByRole('status', { name: 'chemin courant' })).toHaveTextContent('/target');
  });

  test('applique une redirection interne sans quitter le routeur', async () => {
    render(
      <MemoryRouter initialEntries={['/start']}>
        <Routes>
          <Route path="/start" element={<Navigate to="/target" replace />} />
          <Route path="*" element={<CurrentPath />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('status', { name: 'chemin courant' })).toHaveTextContent('/target');
  });
});
