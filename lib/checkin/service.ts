import "server-only";

import { calculateRisk } from "@/lib/checkin/calculate-risk";
import { getCheckinRepository } from "@/lib/checkin/repository-factory";
import { hashToken, isUsableTokenFormat } from "@/lib/checkin/token";
import type { CheckinSubmission, PublicInvitation } from "@/lib/checkin/types";
import { checkinSubmissionSchema } from "@/lib/checkin/validation";

export type CheckinServiceErrorCode =
  | "INVALID_TOKEN"
  | "NOT_FOUND"
  | "EXPIRED"
  | "COMPLETED"
  | "INVALID_ANSWERS"
  | "RATE_LIMITED";

export class CheckinServiceError extends Error {
  constructor(
    public readonly code: CheckinServiceErrorCode,
    public readonly status: number,
    public readonly userMessage: string,
  ) {
    super(code);
  }
}

function requireToken(token: string) {
  if (!isUsableTokenFormat(token)) {
    throw new CheckinServiceError(
      "INVALID_TOKEN",
      404,
      "유효하지 않은 체크인 링크입니다. 메시지의 링크를 다시 확인해 주세요.",
    );
  }
  return hashToken(token);
}

function assertInvitationUsable(invitation: PublicInvitation) {
  // Completed wins over expiry so a returning participant sees a stable result.
  if (invitation.status === "COMPLETED" || invitation.completedAt) return;
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
    throw new CheckinServiceError(
      "EXPIRED",
      410,
      "이 체크인 링크의 응답 기한이 지났습니다. 도움이 필요하면 홈투게더 운영팀에 알려 주세요.",
    );
  }
}

export async function getPublicCheckin(token: string): Promise<PublicInvitation> {
  const repository = await getCheckinRepository();
  const invitation = await repository.findInvitation(requireToken(token));
  if (!invitation) {
    throw new CheckinServiceError(
      "NOT_FOUND",
      404,
      "체크인 링크를 찾을 수 없습니다. 메시지의 링크를 다시 확인해 주세요.",
    );
  }
  assertInvitationUsable(invitation);
  return invitation;
}

export async function saveCheckinDraft(token: string, answers: Record<string, unknown>) {
  const repository = await getCheckinRepository();
  const tokenHash = requireToken(token);
  const invitation = await repository.findInvitation(tokenHash, false);
  if (!invitation) {
    throw new CheckinServiceError("NOT_FOUND", 404, "체크인 링크를 찾을 수 없습니다.");
  }
  assertInvitationUsable(invitation);
  if (invitation.status === "COMPLETED") return invitation;

  try {
    return await repository.saveDraft(tokenHash, answers);
  } catch (error) {
    if (error instanceof Error && error.message === "INVITATION_EXPIRED") {
      throw new CheckinServiceError("EXPIRED", 410, "이 체크인 링크의 응답 기한이 지났습니다.");
    }
    throw error;
  }
}

export async function submitCheckin(token: string, rawSubmission: unknown) {
  const parsed = checkinSubmissionSchema.safeParse(rawSubmission);
  if (!parsed.success) {
    throw new CheckinServiceError(
      "INVALID_ANSWERS",
      400,
      parsed.error.issues[0]?.message ?? "답변을 다시 확인해 주세요.",
    );
  }

  const tokenHash = requireToken(token);
  const repository = await getCheckinRepository();
  const invitation = await repository.findInvitation(tokenHash, false);
  if (!invitation) {
    throw new CheckinServiceError("NOT_FOUND", 404, "체크인 링크를 찾을 수 없습니다.");
  }
  assertInvitationUsable(invitation);

  // questionnaireVersion and the full answer snapshot are persisted. The
  // request schema intentionally has no client-supplied risk fields.
  const submission = parsed.data as CheckinSubmission;
  const history = await repository.getRiskHistory(tokenHash);
  const risk = calculateRisk(submission, history);

  try {
    const result = await repository.submit(tokenHash, submission, risk);
    if (
      (process.env.CRM_WEBHOOK_URL ||
        (result.supportCase && process.env.ADMIN_ALERT_WEBHOOK_URL)) &&
      (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
    ) {
      const { dispatchIntegrationOutbox } = await import("@/lib/webhooks/dispatch-outbox");
      await dispatchIntegrationOutbox().catch((webhookError) => {
        // The transactional outbox remains retryable; never fail or duplicate
        // the participant's already committed response because a webhook is down.
        console.error("[weekly-checkin] webhook delivery deferred", webhookError);
      });
    }
    return {
      responseId: result.response.id,
      completedAt: result.response.submittedAt,
      alreadyCompleted: result.alreadyCompleted,
      safetyNotice: result.response.riskLevel === "RED",
      supportCaseCreated: Boolean(result.supportCase),
    };
  } catch (error) {
    if (error instanceof Error && error.message === "INVITATION_EXPIRED") {
      throw new CheckinServiceError("EXPIRED", 410, "이 체크인 링크의 응답 기한이 지났습니다.");
    }
    throw error;
  }
}

export function serializeServiceError(error: unknown) {
  if (error instanceof CheckinServiceError) {
    return {
      status: error.status,
      body: { error: error.code, message: error.userMessage },
    };
  }
  console.error("[weekly-checkin] unexpected service error", error);
  return {
    status: 500,
    body: { error: "INTERNAL_ERROR", message: "잠시 후 다시 시도해 주세요." },
  };
}
