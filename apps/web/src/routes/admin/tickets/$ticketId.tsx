import React from 'react';
import { useParams } from '@tanstack/react-router';
import { AdminTicketDetailFeature } from '../../../features/admin-tickets/ticket-detail.feature';

export function AdminTicketDetailPage() {
  const { ticketId } = useParams({ strict: false }) as { ticketId: string };
  return <AdminTicketDetailFeature ticketId={ticketId} />;
}
