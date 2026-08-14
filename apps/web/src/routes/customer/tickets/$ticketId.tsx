import React from 'react';
import { useParams } from '@tanstack/react-router';
import { CustomerTicketDetailFeature } from '../../../features/customer-tickets/ticket-detail.feature';

export function CustomerTicketDetailPage() {
  const { ticketId } = useParams({ strict: false }) as { ticketId: string };
  return <CustomerTicketDetailFeature ticketId={ticketId} />;
}
