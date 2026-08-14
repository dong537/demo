export interface CreateTicketDto {
  subject: string;
  body: string;
}

export interface ReplyTicketDto {
  body: string;
}

export interface TicketListItemDto {
  id: string;
  subject: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketMessageDto {
  id: string;
  authorType: string;
  authorId: string;
  body: string;
  createdAt: Date;
}

export interface TicketDetailDto {
  id: string;
  subject: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  messages: TicketMessageDto[];
}

export interface AdminTicketListItemDto {
  id: string;
  subject: string;
  status: string;
  userId: string;
  userEmail: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminTicketDetailDto {
  id: string;
  subject: string;
  status: string;
  userId: string;
  userEmail: string;
  createdAt: Date;
  updatedAt: Date;
  messages: TicketMessageDto[];
}

export interface AdminReplyTicketDto {
  body: string;
}

export interface UpdateTicketStatusDto {
  status: string;
}
