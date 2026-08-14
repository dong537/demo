import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouteTransition } from './route-transition';

describe('RouteTransition', () => {
  it('keeps the route frame stable when the route key changes', () => {
    const { container, rerender } = render(
      <RouteTransition routeKey="/admin/users">
        <div>Users</div>
      </RouteTransition>,
    );

    const firstPanel = container.querySelector('.ipx-route-enter');
    expect(screen.getByText('Users')).toBeInTheDocument();

    rerender(
      <RouteTransition routeKey="/admin/orders">
        <div>Orders</div>
      </RouteTransition>,
    );

    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(container.querySelector('.ipx-route-enter')).toBe(firstPanel);
  });
});
