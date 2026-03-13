"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBearerToken = exports.verifyAuthToken = exports.signAuthToken = exports.verifyPassword = exports.hashPassword = void 0;
const node_crypto_1 = require("node:crypto");
const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 hours
const base64UrlEncode = (value) => Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
const base64UrlDecode = (value) => {
    const padded = value + "=".repeat((4 - (value.length % 4 || 4)) % 4);
    const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64").toString("utf8");
};
const getAuthSecret = () => {
    const secret = process.env.AUTH_SECRET?.trim();
    if (secret) {
        return secret;
    }
    // Fallback apenas para desenvolvimento local.
    return "dev-only-change-me-auth-secret";
};
const hashPassword = (password) => {
    const salt = (0, node_crypto_1.randomBytes)(16).toString("hex");
    const key = (0, node_crypto_1.scryptSync)(password, salt, 64).toString("hex");
    return `${salt}:${key}`;
};
exports.hashPassword = hashPassword;
const verifyPassword = (password, passwordHash) => {
    const [salt, expectedKey] = passwordHash.split(":");
    if (!salt || !expectedKey) {
        return false;
    }
    const derivedKey = (0, node_crypto_1.scryptSync)(password, salt, 64).toString("hex");
    const expectedBuffer = Buffer.from(expectedKey, "hex");
    const derivedBuffer = Buffer.from(derivedKey, "hex");
    if (expectedBuffer.length !== derivedBuffer.length) {
        return false;
    }
    return (0, node_crypto_1.timingSafeEqual)(expectedBuffer, derivedBuffer);
};
exports.verifyPassword = verifyPassword;
const signAuthToken = (payload) => {
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const body = JSON.stringify({ ...payload, exp });
    const bodyEncoded = base64UrlEncode(body);
    const signature = (0, node_crypto_1.createHmac)("sha256", getAuthSecret())
        .update(bodyEncoded)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    return `${bodyEncoded}.${signature}`;
};
exports.signAuthToken = signAuthToken;
const verifyAuthToken = (token) => {
    const [bodyEncoded, signature] = token.split(".");
    if (!bodyEncoded || !signature) {
        return null;
    }
    const expectedSignature = (0, node_crypto_1.createHmac)("sha256", getAuthSecret())
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
    if (!(0, node_crypto_1.timingSafeEqual)(expectedBuffer, signatureBuffer)) {
        return null;
    }
    try {
        const parsed = JSON.parse(base64UrlDecode(bodyEncoded));
        if (!parsed?.userId || !parsed?.tenantId || !parsed?.email || !parsed?.exp) {
            return null;
        }
        if (parsed.exp < Math.floor(Date.now() / 1000)) {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
};
exports.verifyAuthToken = verifyAuthToken;
const getBearerToken = (authorizationHeader) => {
    if (!authorizationHeader) {
        return null;
    }
    const [type, token] = authorizationHeader.split(" ");
    if (!type || !token || type.toLowerCase() !== "bearer") {
        return null;
    }
    return token.trim();
};
exports.getBearerToken = getBearerToken;
