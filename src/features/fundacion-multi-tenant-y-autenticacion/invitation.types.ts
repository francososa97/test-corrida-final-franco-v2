// Tipos de dominio para el flujo de invitacion de usuarios a un tenant (E1-T3).
// Si src/shared/types/index.ts expone Tenant/User/UUID, importarlos desde alli;
// aca se re-declaran los alias minimos para mantener el modulo autocontenido y strict.

export type UUID = string;
export type ISODateString = string;

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

/** Rol con el que el invitado se incorpora al tenant. */
export type TenantRole = 'admin' | 'member';

/** Ventana de validez del token de invitacion: 7 dias en milisegundos. */
export const INVITATION_TTL_MS: number = 7 * 24 * 60 * 60 * 1000;

export interface Invitation {
  readonly id: UUID;
  readonly tenantId: UUID;
  /** Admin (userId) que emitio la invitacion. */
  readonly invitedBy: UUID;
  /** Email destino, normalizado a lowercase. */
  readonly email: string;
  readonly role: TenantRole;
  /** Token opaco que viaja en el link de aceptacion. */
  readonly token: string;
  status: InvitationStatus;
  readonly createdAt: ISODateString;
  /** createdAt + INVITATION_TTL_MS. */
  readonly expiresAt: ISODateString;
  acceptedAt: ISODateString | null;
}

export interface CreateInvitationInput {
  readonly tenantId: UUID;
  readonly invitedBy: UUID;
  readonly email: string;
  readonly role?: TenantRole;
}

export interface AcceptInvitationResult {
  readonly invitation: Invitation;
}

/** Puerto de persistencia; la implementacion real (SQL/Prisma) se inyecta. */
export interface InvitationRepository {
  create(invitation: Invitation): Promise<Invitation>;
  findByToken(token: string): Promise<Invitation | null>;
  findPendingByTenantAndEmail(tenantId: UUID, email: string): Promise<Invitation | null>;
  update(invitation: Invitation): Promise<Invitation>;
}

/** Errores de dominio con codigo estable para mapear a HTTP. */
export type InvitationErrorCode =
  | 'INVITATION_NOT_FOUND'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_ALREADY_USED'
  | 'INVITATION_REVOKED'
  | 'INVALID_EMAIL'
  | 'DUPLICATE_PENDING_INVITATION';

export class InvitationError extends Error {
  public readonly code: InvitationErrorCode;
  constructor(code: InvitationErrorCode, message: string) {
    super(message);
    this.name = 'InvitationError';
    this.code = code;
  }
}
