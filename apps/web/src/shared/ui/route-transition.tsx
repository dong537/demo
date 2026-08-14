import type { ReactNode } from 'react';

interface RouteTransitionProps {
  routeKey: string;
  children: ReactNode;
}

export function RouteTransition({ routeKey: _routeKey, children }: RouteTransitionProps) {
  return (
    <div
      className="ipx-route-frame"
      data-navigating="false"
      aria-busy={false}
    >
      <div className="ipx-route-enter">
        {children}
      </div>
    </div>
  );
}
