"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, LoaderCircle } from "lucide-react";

import { CheckinShell } from "@/components/checkin/CheckinShell";
import { MultiChoiceCards, SingleChoiceCards } from "@/components/checkin/ChoiceCards";
import type { CheckinStepId } from "@/lib/checkin/branching-engine";
import {
  additionalIssueOptions,
  clarificationPreferenceOptions,
  contactMethodOptions,
  contactWindowOptions,
  createQuestionnaireSnapshot,
  desiredActionOptions,
  disclosurePreferenceOptions,
  discussionStatusOptions,
  frequencyOptions,
  immediateDangerOptions,
  issueCategoryOptions,
  issueStatusOptions,
  issueSubcategoryOptions,
  overallStatusOptions,
  positivePointOptions,
  questionnaireNotices,
  safeLocationOptions,
  safeToContactOptions,
  severityOptions,
} from "@/lib/checkin/question-tree";
import {
  QUESTIONNAIRE_VERSION,
  type CheckinIssueInput,
  type CheckinSubmission,
  type ClarificationPreference,
  type ContactMethod,
  type ContactWindow,
  type DesiredAction,
  type DisclosurePreference,
  type DiscussionStatus,
  type Frequency,
  type ImmediateDanger,
  type IssueCategory,
  type IssueStatus,
  type OverallStatus,
  type PositivePoint,
  type SafeLocation,
  type SafeToContact,
} from "@/lib/checkin/types";

interface InvitationDto {
  recipientName: string;
  role: "HOST" | "GUEST";
  period: string;
  expiresAt: string;
  status: string;
  completedAt?: string;
  draft?: Partial<FlowDraft>;
}

interface ApiErrorDto {
  message?: string;
  requestId?: string;
}

function apiErrorMessage(
  payload: ApiErrorDto,
  fallback: string,
): string {
  const message = payload.message ?? fallback;
  return payload.requestId
    ? `${message} (문의 코드: ${payload.requestId})`
    : message;
}

interface CurrentIssue {
  category?: IssueCategory;
  subcategory?: string;
  frequency?: Frequency;
  severity?: 1 | 2 | 3 | 4 | 5;
  discussionStatus?: DiscussionStatus;
  desiredAction?: DesiredAction;
  clarificationPreference?: ClarificationPreference;
}

interface FlowDraft {
  step: CheckinStepId;
  history: CheckinStepId[];
  overallStatus?: OverallStatus;
  issueStatus?: IssueStatus;
  positivePoints: PositivePoint[];
  issues: CheckinIssueInput[];
  currentIssue: CurrentIssue;
  disclosurePreference?: DisclosurePreference;
  contactMethod?: ContactMethod;
  contactWindow?: ContactWindow;
  immediateDanger?: ImmediateDanger;
  safeToContact?: SafeToContact;
  safeLocation?: SafeLocation;
  wantsAnotherIssue?: "YES" | "NO";
}

const initialDraft: FlowDraft = {
  step: "OVERALL_STATUS",
  history: [],
  positivePoints: [],
  issues: [],
  currentIssue: {},
};

const stepCopy: Record<CheckinStepId, { eyebrow: string; title: string; help?: string }> = {
  OVERALL_STATUS: {
    eyebrow: "이번 주를 돌아볼게요",
    title: "공동생활은 전반적으로 어떠셨나요?",
  },
  ISSUE_STATUS: { eyebrow: "불편 확인", title: "이번 주에 불편한 점이 있었나요?" },
  POSITIVE_POINTS: {
    eyebrow: "거의 다 왔어요",
    title: "이번 주 공동생활에서 괜찮았던 점이 있나요?",
    help: "해당하는 항목을 모두 선택하거나 건너뛸 수 있어요.",
  },
  ISSUE_CATEGORY: {
    eyebrow: "가장 먼저 해결할 것",
    title: "어떤 점이 가장 불편했나요?",
    help: "여러 가지라면 지금 가장 먼저 해결하고 싶은 항목을 골라 주세요.",
  },
  ISSUE_SUBCATEGORY: { eyebrow: "조금 더 자세히", title: "어떤 상황에 가까운가요?" },
  CLARIFICATION_PREFERENCE: {
    eyebrow: "추가 설명",
    title: "선택하신 항목을 어떻게 남길까요?",
  },
  FREQUENCY: { eyebrow: "발생 빈도", title: "이번 주에 얼마나 자주 있었나요?" },
  SEVERITY: { eyebrow: "생활 영향도", title: "현재 생활에 어느 정도 영향을 주고 있나요?" },
  DISCUSSION_STATUS: {
    eyebrow: "대화 여부",
    title: "상대방과 이 문제를 이야기해 보셨나요?",
  },
  DESIRED_ACTION: { eyebrow: "필요한 지원", title: "홈투게더가 어떻게 도와드리면 좋을까요?" },
  DISCLOSURE_PREFERENCE: {
    eyebrow: "전달 동의",
    title: "응답 내용을 다루는 방식을 선택해 주세요.",
    help: questionnaireNotices.disclosure,
  },
  CONTACT_METHOD: { eyebrow: "연락 방식", title: "어떤 방식으로 연락드리면 좋을까요?" },
  CONTACT_WINDOW: { eyebrow: "연락 시간", title: "연락받기 편한 시간은 언제인가요?" },
  ADDITIONAL_ISSUE: { eyebrow: "추가 불편", title: "다른 불편한 점도 남기시겠어요?" },
  SAFETY_IMMEDIATE_DANGER: {
    eyebrow: "안전 확인",
    title: "현재 즉시 위험한 상황인가요?",
    help: "안전 확인을 위해 꼭 필요한 질문입니다.",
  },
  SAFETY_SAFE_TO_CONTACT: {
    eyebrow: "안전 확인",
    title: "홈투게더가 지금 연락해도 안전한가요?",
  },
  SAFETY_SAFE_LOCATION: {
    eyebrow: "안전 확인",
    title: "현재 안전한 공간에 계신가요?",
  },
  COMPLETE: { eyebrow: "제출", title: "답변을 안전하게 저장하고 있어요." },
};

function completeSafetyIssue(issue: CurrentIssue): CheckinIssueInput | null {
  if (!issue.category) return null;
  return {
    category: issue.category,
    subcategory: issue.subcategory ?? "GENERAL_UNSAFE_FEELING",
    frequency: issue.frequency ?? "UNKNOWN",
    severity: issue.severity ?? 5,
    discussionStatus: issue.discussionStatus ?? "DIFFICULT_TO_DISCUSS",
    desiredAction: issue.desiredAction ?? "URGENT_CONTACT",
    clarificationPreference: issue.clarificationPreference,
  };
}

export function CheckinFlow({ token }: { token: string }) {
  const router = useRouter();
  const [invitation, setInvitation] = useState<InvitationDto | null>(null);
  const [draft, setDraft] = useState<FlowDraft>(initialDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const hydrated = useRef(false);

  useEffect(() => {
    let active = true;
    void fetch(`/api/checkins/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          invitation?: InvitationDto;
          message?: string;
          requestId?: string;
        };
        if (!response.ok) {
          throw new Error(
            apiErrorMessage(payload, "체크인 정보를 불러오지 못했습니다."),
          );
        }
        if (!active || !payload.invitation) return;
        setInvitation(payload.invitation);
        if (payload.invitation.status === "COMPLETED") {
          router.replace(`/checkin/${encodeURIComponent(token)}/completed`);
          return;
        }
        if (payload.invitation.draft?.step) {
          setDraft({ ...initialDraft, ...payload.invitation.draft } as FlowDraft);
        }
        hydrated.current = true;
      })
      .catch((loadError: Error) => active && setError(loadError.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [router, token]);

  useEffect(() => {
    if (!hydrated.current || loading || submitting) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSaving(true);
      void fetch(`/api/checkins/${encodeURIComponent(token)}/draft`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: draft }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (response.ok) return;
          const payload = (await response.json()) as ApiErrorDto;
          throw new Error(apiErrorMessage(payload, "임시 저장에 실패했습니다."));
        })
        .catch((draftError: Error) => {
          if (draftError.name !== "AbortError") {
            setError(`${draftError.message} 다음 선택에서 다시 시도합니다.`);
          }
        })
        .finally(() => setSaving(false));
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [draft, loading, submitting, token]);

  const progress = useMemo(
    () => Math.min(95, Math.max(10, 12 + draft.history.length * 7 + draft.issues.length * 4)),
    [draft.history.length, draft.issues.length],
  );

  const go = (next: CheckinStepId) => {
    setDraft((current) => ({ ...current, step: next, history: [...current.history, current.step] }));
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const back = () => {
    setDraft((current) => {
      const history = [...current.history];
      const previous = history.pop();
      if (!previous) return current;
      if (current.step === "ADDITIONAL_ISSUE" && previous === "DESIRED_ACTION") {
        const issues = [...current.issues];
        const currentIssue = issues.pop() ?? current.currentIssue;
        return { ...current, issues, currentIssue, wantsAnotherIssue: undefined, step: previous, history };
      }
      if (current.step === "SAFETY_IMMEDIATE_DANGER") {
        const issues = [...current.issues];
        const last = issues.at(-1);
        if (
          last &&
          last.category === current.currentIssue.category &&
          last.subcategory === (current.currentIssue.subcategory ?? "GENERAL_UNSAFE_FEELING")
        ) {
          issues.pop();
        }
        return {
          ...current,
          issues,
          immediateDanger: undefined,
          safeToContact: undefined,
          safeLocation: undefined,
          step: previous,
          history,
        };
      }
      return { ...current, step: previous, history };
    });
  };

  const enterSafety = (nextDraft: FlowDraft) => {
    const issue = completeSafetyIssue(nextDraft.currentIssue);
    setDraft({
      ...nextDraft,
      issues: issue
        ? [...nextDraft.issues.filter((item) => item !== issue), issue].slice(0, 3)
        : nextDraft.issues,
      step: "SAFETY_IMMEDIATE_DANGER",
      history: [...nextDraft.history, nextDraft.step],
    });
  };

  const buildSubmission = (): CheckinSubmission => ({
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    overallStatus: draft.overallStatus!,
    issueStatus: draft.issueStatus,
    positivePoints: draft.positivePoints,
    issues: draft.issues,
    disclosurePreference: draft.disclosurePreference,
    contactMethod: draft.contactMethod,
    contactWindow: draft.contactWindow,
    safety:
      draft.immediateDanger && draft.safeToContact && draft.safeLocation
        ? {
            immediateDanger: draft.immediateDanger,
            safeToContact: draft.safeToContact,
            safeLocation: draft.safeLocation,
          }
        : undefined,
    questionSnapshot: createQuestionnaireSnapshot(),
  });

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/checkins/${encodeURIComponent(token)}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildSubmission()),
      });
      const payload = (await response.json()) as {
        message?: string;
        requestId?: string;
        safetyNotice?: boolean;
      };
      if (!response.ok) {
        throw new Error(apiErrorMessage(payload, "제출하지 못했습니다."));
      }
      router.replace(
        `/checkin/${encodeURIComponent(token)}/completed${payload.safetyNotice ? "?safety=1" : ""}`,
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "잠시 후 다시 시도해 주세요.");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="centered-state" aria-live="polite">
        <LoaderCircle className="spin" size={28} />
        <p>안전한 체크인 링크를 확인하고 있어요.</p>
      </main>
    );
  }

  if (error && !invitation) {
    return (
      <main className="centered-state error-state" role="alert">
        <AlertTriangle size={28} />
        <h1>링크를 확인해 주세요</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!invitation) return null;
  const copy = stepCopy[draft.step];
  const currentCategory = draft.currentIssue.category;
  const subcategoryOptions = currentCategory ? issueSubcategoryOptions[currentCategory] : [];

  let choices: React.ReactNode;
  let canContinue = false;
  let next: (() => void) | undefined;

  switch (draft.step) {
    case "OVERALL_STATUS":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={overallStatusOptions}
          value={draft.overallStatus}
          onChange={(value) => {
            const nextDraft = { ...draft, overallStatus: value };
            if (value === "NEED_HELP_NOW") enterSafety(nextDraft);
            else setDraft(nextDraft);
          }}
        />
      );
      canContinue = Boolean(draft.overallStatus);
      next = () => go("ISSUE_STATUS");
      break;
    case "ISSUE_STATUS":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={issueStatusOptions}
          value={draft.issueStatus}
          onChange={(value) => setDraft({ ...draft, issueStatus: value })}
        />
      );
      canContinue = Boolean(draft.issueStatus);
      next = () => go(draft.issueStatus === "NO_ISSUE" ? "POSITIVE_POINTS" : "ISSUE_CATEGORY");
      break;
    case "POSITIVE_POINTS":
      choices = (
        <MultiChoiceCards
          name={copy.title}
          options={positivePointOptions}
          values={draft.positivePoints}
          onChange={(positivePoints) => setDraft({ ...draft, positivePoints })}
        />
      );
      canContinue = true;
      next = submit;
      break;
    case "ISSUE_CATEGORY":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={issueCategoryOptions}
          value={draft.currentIssue.category}
          onChange={(category) => {
            // Safety is intentionally not an immediate jump: the selected
            // subcategory is required for operations to distinguish threats,
            // unwanted contact and general safety concerns before entering the
            // protected safety questions.
            setDraft({ ...draft, currentIssue: { category } });
          }}
        />
      );
      canContinue = Boolean(draft.currentIssue.category);
      next = () => go("ISSUE_SUBCATEGORY");
      break;
    case "ISSUE_SUBCATEGORY":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={subcategoryOptions}
          value={draft.currentIssue.subcategory}
          onChange={(subcategory) => {
            const nextDraft = { ...draft, currentIssue: { ...draft.currentIssue, subcategory } };
            if (
              draft.currentIssue.category === "SAFETY" ||
              [
                "UNWANTED_PHYSICAL_CONTACT",
                "SEXUAL_REMARK_OR_BEHAVIOR",
                "PHYSICAL_THREAT_VIOLENCE",
                "AFRAID_TO_STAY",
              ].includes(subcategory)
            ) {
              enterSafety(nextDraft);
            } else setDraft(nextDraft);
          }}
        />
      );
      canContinue = Boolean(draft.currentIssue.subcategory);
      next = () =>
        go(
          draft.currentIssue.category === "UNKNOWN" ||
            draft.currentIssue.subcategory?.startsWith("OTHER_")
            ? "CLARIFICATION_PREFERENCE"
            : "FREQUENCY",
        );
      break;
    case "CLARIFICATION_PREFERENCE":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={clarificationPreferenceOptions}
          value={draft.currentIssue.clarificationPreference}
          onChange={(clarificationPreference) =>
            setDraft({ ...draft, currentIssue: { ...draft.currentIssue, clarificationPreference } })
          }
        />
      );
      canContinue = Boolean(draft.currentIssue.clarificationPreference);
      next = () => go("FREQUENCY");
      break;
    case "FREQUENCY":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={frequencyOptions}
          value={draft.currentIssue.frequency}
          onChange={(frequency) => setDraft({ ...draft, currentIssue: { ...draft.currentIssue, frequency } })}
        />
      );
      canContinue = Boolean(draft.currentIssue.frequency);
      next = () => go("SEVERITY");
      break;
    case "SEVERITY":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={severityOptions}
          value={draft.currentIssue.severity}
          onChange={(severity) => {
            const nextDraft = { ...draft, currentIssue: { ...draft.currentIssue, severity } };
            if (severity === 5) enterSafety(nextDraft);
            else setDraft(nextDraft);
          }}
        />
      );
      canContinue = Boolean(draft.currentIssue.severity);
      next = () => go("DISCUSSION_STATUS");
      break;
    case "DISCUSSION_STATUS":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={discussionStatusOptions}
          value={draft.currentIssue.discussionStatus}
          onChange={(discussionStatus) =>
            setDraft({ ...draft, currentIssue: { ...draft.currentIssue, discussionStatus } })
          }
        />
      );
      canContinue = Boolean(draft.currentIssue.discussionStatus);
      next = () => go("DESIRED_ACTION");
      break;
    case "DESIRED_ACTION":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={desiredActionOptions}
          value={draft.currentIssue.desiredAction}
          onChange={(desiredAction) =>
            setDraft({ ...draft, currentIssue: { ...draft.currentIssue, desiredAction } })
          }
        />
      );
      canContinue = Boolean(draft.currentIssue.desiredAction);
      next = () => {
        setDraft((current) => ({
          ...current,
          issues: [...current.issues, current.currentIssue as CheckinIssueInput].slice(0, 3),
          currentIssue: {},
          step: "ADDITIONAL_ISSUE",
          history: [...current.history, current.step],
        }));
      };
      break;
    case "ADDITIONAL_ISSUE":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={draft.issues.length >= 3 ? additionalIssueOptions.slice(0, 1) : additionalIssueOptions}
          value={draft.wantsAnotherIssue}
          onChange={(wantsAnotherIssue) => setDraft({ ...draft, wantsAnotherIssue })}
        />
      );
      canContinue = Boolean(draft.wantsAnotherIssue);
      next = () => {
        if (draft.wantsAnotherIssue === "YES" && draft.issues.length < 3) {
          setDraft({
            ...draft,
            currentIssue: {},
            wantsAnotherIssue: undefined,
            step: "ISSUE_CATEGORY",
            history: [...draft.history, draft.step],
          });
        } else go("DISCLOSURE_PREFERENCE");
      };
      break;
    case "DISCLOSURE_PREFERENCE":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={disclosurePreferenceOptions}
          value={draft.disclosurePreference}
          onChange={(disclosurePreference) => setDraft({ ...draft, disclosurePreference })}
        />
      );
      canContinue = Boolean(draft.disclosurePreference);
      next = () => go("CONTACT_METHOD");
      break;
    case "CONTACT_METHOD":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={contactMethodOptions}
          value={draft.contactMethod}
          onChange={(contactMethod) => setDraft({ ...draft, contactMethod })}
        />
      );
      canContinue = Boolean(draft.contactMethod);
      next = () => (draft.contactMethod === "NO_CONTACT" ? void submit() : go("CONTACT_WINDOW"));
      break;
    case "CONTACT_WINDOW":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={contactWindowOptions}
          value={draft.contactWindow}
          onChange={(contactWindow) => setDraft({ ...draft, contactWindow })}
        />
      );
      canContinue = Boolean(draft.contactWindow);
      next = submit;
      break;
    case "SAFETY_IMMEDIATE_DANGER":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={immediateDangerOptions}
          value={draft.immediateDanger}
          onChange={(immediateDanger) => setDraft({ ...draft, immediateDanger })}
        />
      );
      canContinue = Boolean(draft.immediateDanger);
      next = () => go("SAFETY_SAFE_TO_CONTACT");
      break;
    case "SAFETY_SAFE_TO_CONTACT":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={safeToContactOptions}
          value={draft.safeToContact}
          onChange={(safeToContact) => setDraft({ ...draft, safeToContact })}
        />
      );
      canContinue = Boolean(draft.safeToContact);
      next = () => go("SAFETY_SAFE_LOCATION");
      break;
    case "SAFETY_SAFE_LOCATION":
      choices = (
        <SingleChoiceCards
          name={copy.title}
          options={safeLocationOptions}
          value={draft.safeLocation}
          onChange={(safeLocation) => setDraft({ ...draft, safeLocation })}
        />
      );
      canContinue = Boolean(draft.safeLocation);
      next = submit;
      break;
    case "COMPLETE":
      choices = <div className="loading-panel">제출 중입니다.</div>;
      break;
  }

  return (
    <CheckinShell
      progress={progress}
      recipientName={invitation.recipientName}
      period={invitation.period}
      onBack={draft.history.length ? back : undefined}
    >
      <div className="question-heading">
        <p className="question-eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        {copy.help ? <p className="question-help">{copy.help}</p> : null}
      </div>
      {choices}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <button
        type="button"
        className="primary-button"
        disabled={!canContinue || submitting}
        onClick={next}
      >
        {submitting ? (
          <>
            <LoaderCircle className="spin" size={20} /> 안전하게 저장 중
          </>
        ) : draft.step === "POSITIVE_POINTS" ||
          draft.step === "CONTACT_WINDOW" ||
          draft.step === "SAFETY_SAFE_LOCATION" ||
          (draft.step === "CONTACT_METHOD" && draft.contactMethod === "NO_CONTACT") ? (
          "체크인 제출하기"
        ) : (
          "다음"
        )}
      </button>
      <p className="save-status" aria-live="polite">{saving ? "답변 저장 중…" : "선택한 답변은 자동으로 저장됩니다."}</p>
    </CheckinShell>
  );
}
