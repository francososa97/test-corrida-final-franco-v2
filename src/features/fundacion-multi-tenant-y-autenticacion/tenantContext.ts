import type { Pool, PoolClient } from 'pg';
import { APP_ROLE, TENANT_GUC } from './schema';

/** Identificador de tenant (UUID en formato string). */
export type TenantId = string;

/** UUID v1-v5 laxo: valida forma antes de tocar la base. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertTenantId(tenantId: TenantId): void {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`tenantId invalido: ${tenantId}`);
  }
}

/**
 * Ejecuta `work` dentro de una transaccion con el contexto de tenant activo.
 *
 * Garantias de aislamiento:
 *  1. `SET LOCAL ROLE app_user` => cambia al rol NO-superusuario, unico sobre
 *     el que RLS se evalua. El SET LOCAL revierte al terminar la transaccion.
 *  2. `set_config(..., is_local => true)` => setea la GUC del tenant SOLO para
 *     esta transaccion y de forma parametrizada (sin interpolar => sin inyeccion).
 *  3. Toda query dentro de `work` queda filtrada por la policy
 *     `tenant_id = current_tenant_id()`.
 *
 * El pool debe conectarse con un rol que sea MIEMBRO de `app_user` (o superuser)
 * para poder hacer SET ROLE.
 */
export async function withTenant<T>(
  pool: Pool,
  tenantId: TenantId,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId);

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    // Rol de app => RLS activo. SET LOCAL vive solo en esta transaccion.
    await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
    // Tenant activo, parametrizado y local a la transaccion.
    await client.query('SELECT set_config($1, $2, true)', [TENANT_GUC, tenantId]);

    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
