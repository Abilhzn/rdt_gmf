export interface Identity {
  userId: string;
  dinas: string;
  role: string;
}

export interface IdentityProvider {
  resolve(req: unknown): Identity;
}

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');
