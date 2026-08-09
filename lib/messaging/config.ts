import "server-only";

export type MessagingConfigurationStatus = {
  provider: string;
  credentialsConfigured: boolean;
  senderProfileConfigured: boolean;
  templateConfigured: boolean;
  callbackConfigured: boolean;
  sendingEnabled: boolean;
  readyForProduction: boolean;
  readyForAdminTest: boolean;
  missing: string[];
};

export type AlimtalkRuntimeConfig = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  senderProfile: string;
  templateCode: string;
  callbackSecret?: string;
};

// The provider-neutral callback route and durable receipt state machine are
// part of the application. Production readiness still requires a signing
// secret, selected provider, approved template, credentials, and the explicit
// CHECKIN_SENDING_ENABLED gate.
function callbackRouteImplemented(): boolean {
  return true;
}

const providerKeyPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const disabledProviderKeys = new Set(["mock", "disabled", "none"]);

function value(...names: string[]): string | undefined {
  for (const name of names) {
    const candidate = process.env[name]?.trim();
    if (candidate) return candidate;
  }
  return undefined;
}

function validApiBaseUrl(candidate: string | undefined): boolean {
  if (!candidate) return false;
  try {
    const parsed = new URL(candidate);
    return process.env.NODE_ENV === "production"
      ? parsed.protocol === "https:"
      : parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function validPublicCheckinUrl(candidate: string | undefined): boolean {
  if (!candidate) return false;
  try {
    return new URL(candidate).protocol === "https:";
  } catch {
    return false;
  }
}

export function getMessagingConfigurationStatus(): MessagingConfigurationStatus {
  const provider = value("ALIMTALK_PROVIDER", "MESSAGING_PROVIDER")?.toLowerCase() ?? "mock";
  const baseUrl = value("ALIMTALK_API_BASE_URL", "KAKAO_API_BASE_URL");
  const apiKey = value("ALIMTALK_API_KEY", "KAKAO_API_KEY");
  const apiSecret = value("ALIMTALK_API_SECRET", "KAKAO_API_SECRET");
  const senderProfile = value("ALIMTALK_SENDER_PROFILE", "KAKAO_SENDER_KEY");
  const templateCode = value("ALIMTALK_TEMPLATE_CODE", "KAKAO_WEEKLY_CHECKIN_TEMPLATE_CODE");
  const callbackSecret = value("ALIMTALK_CALLBACK_SECRET", "KAKAO_CALLBACK_SECRET");
  const publicCheckinUrl = value(
    "PUBLIC_CHECKIN_BASE_URL",
    "APP_BASE_URL",
    "NEXT_PUBLIC_APP_URL",
  );
  const providerSelected =
    providerKeyPattern.test(provider) && !disabledProviderKeys.has(provider);
  const credentialsConfigured = Boolean(
    providerSelected && validApiBaseUrl(baseUrl) && apiKey && apiSecret,
  );
  const senderProfileConfigured = Boolean(senderProfile);
  const templateConfigured = Boolean(templateCode);
  const callbackSecretConfigured = Boolean(callbackSecret && callbackSecret.length >= 16);
  const callbackRouteConfigured = callbackRouteImplemented();
  const callbackConfigured = callbackSecretConfigured && callbackRouteConfigured;
  const sendingEnabled = process.env.CHECKIN_SENDING_ENABLED === "true";
  const readyForAdminTest =
    providerSelected &&
    credentialsConfigured &&
    senderProfileConfigured &&
    templateConfigured &&
    callbackConfigured &&
    validPublicCheckinUrl(publicCheckinUrl);
  const readyForProduction = readyForAdminTest && sendingEnabled;
  const missing: string[] = [];

  if (!providerSelected) missing.push("ALIMTALK_PROVIDER");
  if (!validApiBaseUrl(baseUrl)) missing.push("ALIMTALK_API_BASE_URL");
  if (!apiKey) missing.push("ALIMTALK_API_KEY");
  if (!apiSecret) missing.push("ALIMTALK_API_SECRET");
  if (!senderProfile) missing.push("ALIMTALK_SENDER_PROFILE");
  if (!templateCode) missing.push("ALIMTALK_TEMPLATE_CODE");
  if (!validPublicCheckinUrl(publicCheckinUrl)) missing.push("PUBLIC_CHECKIN_BASE_URL");
  if (!callbackSecretConfigured) missing.push("ALIMTALK_CALLBACK_SECRET");
  if (!callbackRouteConfigured) missing.push("ALIMTALK_CALLBACK_ROUTE_IMPLEMENTATION");
  if (!sendingEnabled) missing.push("CHECKIN_SENDING_ENABLED");

  return {
    provider,
    credentialsConfigured,
    senderProfileConfigured,
    templateConfigured,
    callbackConfigured,
    sendingEnabled,
    readyForProduction,
    readyForAdminTest,
    missing,
  };
}

export function getAlimtalkRuntimeConfig(): AlimtalkRuntimeConfig {
  const status = getMessagingConfigurationStatus();
  if (!status.readyForAdminTest) {
    throw new Error(`ALIMTALK_CONFIGURATION_MISSING:${status.missing.join(",")}`);
  }

  return {
    provider: status.provider,
    baseUrl: value("ALIMTALK_API_BASE_URL", "KAKAO_API_BASE_URL")!,
    apiKey: value("ALIMTALK_API_KEY", "KAKAO_API_KEY")!,
    apiSecret: value("ALIMTALK_API_SECRET", "KAKAO_API_SECRET")!,
    senderProfile: value("ALIMTALK_SENDER_PROFILE", "KAKAO_SENDER_KEY")!,
    templateCode: value("ALIMTALK_TEMPLATE_CODE", "KAKAO_WEEKLY_CHECKIN_TEMPLATE_CODE")!,
    callbackSecret: value("ALIMTALK_CALLBACK_SECRET", "KAKAO_CALLBACK_SECRET"),
  };
}

export function getPublicCheckinBaseUrl(): string {
  const configured = value(
    "PUBLIC_CHECKIN_BASE_URL",
    "APP_BASE_URL",
    "NEXT_PUBLIC_APP_URL",
  );
  const candidate = configured ?? (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000");
  if (!candidate) throw new Error("PUBLIC_CHECKIN_BASE_URL is required");

  const parsed = new URL(candidate);
  if (
    process.env.NODE_ENV === "production" &&
    parsed.protocol !== "https:"
  ) {
    throw new Error("PUBLIC_CHECKIN_BASE_URL must use HTTPS in production");
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error("PUBLIC_CHECKIN_BASE_URL must be HTTP(S)");
  }

  return parsed.origin.replace(/\/$/, "");
}

/**
 * Canonical provider key shared by outbox rows, status lookups, and callbacks.
 * Changing vendors intentionally leaves old rows bound to their original
 * provider rather than silently claiming them through a different adapter.
 */
export function getMessageQueueProvider(): string {
  const provider = getMessagingConfigurationStatus().provider;
  if (!providerKeyPattern.test(provider) || disabledProviderKeys.has(provider)) {
    throw new Error("ALIMTALK_PROVIDER_NOT_CONFIGURED");
  }
  return provider;
}
