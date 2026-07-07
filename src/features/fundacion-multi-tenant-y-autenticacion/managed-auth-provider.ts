// Integración con proveedor de Auth managed (estilo GoTrue/Auth0/Supabase Auth).
// El proveedor concreto se abstrae detrás de una interfaz para poder inyectar
// un mock en tests y mantener el servicio agnóstico del vendor.

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export interface AuthToken {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: 'bearer';
  readonly expiresIn: number;
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly tenantId: string;
}

export interface AuthSession {
  readonly token: AuthToken;
  readonly user: AuthenticatedUser;
}

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'user_already_exists'
  | 'provider_unavailable';

export class AuthError extends Error {
  public readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/** Contrato mínimo que debe cumplir cualquier proveedor de Auth managed. */
export interface ManagedAuthProvider {
  signUp(credentials: Credentials, tenantId: string): Promise<AuthSession>;
  signInWithPassword(credentials: Credentials): Promise<AuthSession>;
}

export interface ManagedAuthConfig {
  /** URL base del proveedor managed, ej: https://<proyecto>.auth.example.com */
  readonly baseUrl: string;
  /** API key pública/anon del proyecto en el proveedor. */
  readonly apiKey: string;
  /** Implementación de fetch inyectable (default: fetch global). */
  readonly fetchImpl?: typeof fetch;
}

interface ProviderTokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly app_metadata?: { readonly tenant_id?: string };
  };
}

/**
 * Cliente HTTP contra un proveedor de Auth managed compatible con el flujo
 * OAuth password grant. Traduce las respuestas del vendor a tipos del dominio.
 */
export class HttpManagedAuthProvider implements ManagedAuthProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ManagedAuthConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  public async signUp(credentials: Credentials, tenantId: string): Promise<AuthSession> {
    const response = await this.request('/signup', {
      email: credentials.email,
      password: credentials.password,
      data: { tenant_id: tenantId },
    });

    if (response.status === 409 || response.status === 422) {
      throw new AuthError('user_already_exists', 'El usuario ya existe');
    }
    return this.toSession(await this.parseOk(response), tenantId);
  }

  public async signInWithPassword(credentials: Credentials): Promise<AuthSession> {
    const response = await this.request('/token?grant_type=password', {
      email: credentials.email,
      password: credentials.password,
    });

    if (response.status === 400 || response.status === 401) {
      throw new AuthError('invalid_credentials', 'Credenciales inválidas');
    }
    return this.toSession(await this.parseOk(response));
  }

  private async request(path: string, body: unknown): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.apiKey,
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new AuthError('provider_unavailable', 'El proveedor de Auth no respondió');
    }
  }

  private async parseOk(response: Response): Promise<ProviderTokenResponse> {
    if (!response.ok) {
      throw new AuthError('provider_unavailable', `Auth managed respondió ${response.status}`);
    }
    return (await response.json()) as ProviderTokenResponse;
  }

  private toSession(payload: ProviderTokenResponse, fallbackTenantId?: string): AuthSession {
    const tenantId = payload.user.app_metadata?.tenant_id ?? fallbackTenantId;
    if (tenantId === undefined) {
      throw new AuthError('provider_unavailable', 'El proveedor no devolvió tenant_id');
    }
    return {
      token: {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        tokenType: 'bearer',
        expiresIn: payload.expires_in,
      },
      user: {
        id: payload.user.id,
        email: payload.user.email,
        tenantId,
      },
    };
  }
}
