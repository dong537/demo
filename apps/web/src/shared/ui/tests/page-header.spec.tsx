import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { PageHeader } from '../page-header';

describe('PageHeader', () => {
  it('renders the title, optional description and extra slot', () => {
    render(
      <PageHeader
        title="My Proxies"
        description="Manage your active proxies"
        extra={<button type="button">New</button>}
      />,
    );

    expect(screen.getByText('My Proxies')).toBeInTheDocument();
    expect(screen.getByText('Manage your active proxies')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });

  it('renders without description or extra', () => {
    render(<PageHeader title="Tickets" />);

    expect(screen.getByText('Tickets')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
