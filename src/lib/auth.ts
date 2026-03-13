import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 hours

const base64UrlEncode = (value: string): string =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const base64UrlDecode = (value: string): string => {
  const padded = value + "=".repeat((4 - (value.length % 4 || 4)) % 4);
  const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
};

const getAuthSecret = (): string => {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) {
    return secret;
  }

  // Fallback apenas para desenvolvimento local.
  return "dev-only-change-me-auth-secret";
};

export interface AuthTokenPayload {
  userId: string;
  tenantId: string;
  email: string;
  exp: number;
}

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${key}`;
};

export const verifyPassword = (password: string, passwordHash: string): boolean => {
  const [salt, expectedKey] = passwordHash.split(":");
  if (!salt || !expectedKey) {
    return false;
  }

  const derivedKey = scryptSync(password, salt, 64).toString("hex");
  const expectedBuffer = Buffer.from(expectedKey, "hex");
  const derivedBuffer = Buffer.from(derivedKey, "hex");
  if (expectedBuffer.length !== derivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, derivedBuffer);
};

export const signAuthToken = (payload: Omit<AuthTokenPayload, "exp">): string => {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const body = JSON.stringify({ ...payload, exp });
  const bodyEncoded = base64UrlEncode(body);
  const signature = createHmac("sha256", getAuthSecret())
    .update(bodyEncoded)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${bodyEncoded}.${signature}`;
};

export const verifyAuthToken = (token: string): AuthTokenPayload | null => {
  const [bodyEncoded, signature] = token.split(".");
  if (!bodyEncoded || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", getAuthSecret())
    .update(bodyEncoded)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== signatureBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(bodyEncoded)) as AuthTokenPayload;
    if (!parsed?.userId || !parsed?.tenantId || !parsed?.email || !parsed?.exp) {
      return null;
    }
    if (parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const getBearerToken = (authorizationHeader?: string): string | null => {
  if (!authorizationHeader) {
    return null;
  }
  const [type, token] = authorizationHeader.split(" ");
  if (!type || !token || type.toLowerCase() !== "bearer") {
    return null;
  }
  return token.trim();
};
