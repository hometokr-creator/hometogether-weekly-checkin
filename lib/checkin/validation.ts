import { z } from "zod";

import {
  isValidSubcategory,
  requiresClarificationPreference,
} from "@/lib/checkin/branching-engine";
import {
  QUESTIONNAIRE_VERSION,
  contactMethods,
  contactWindows,
  desiredActions,
  disclosurePreferences,
  discussionStatuses,
  frequencies,
  immediateDangerValues,
  issueCategories,
  issueStatuses,
  overallStatuses,
  positivePointValues,
  safeLocationValues,
  safeToContactValues,
} from "@/lib/checkin/types";

const issueSchema = z.object({
  category: z.enum(issueCategories),
  subcategory: z.string().trim().min(1).max(80),
  frequency: z.enum(frequencies),
  severity: z.number().int().min(1).max(5),
  discussionStatus: z.enum(discussionStatuses),
  desiredAction: z.enum(desiredActions),
  clarificationPreference: z.enum(["CONTACT_TO_EXPLAIN", "RECORD_WITHOUT_DETAILS"]).optional(),
  additionalNote: z.string().trim().max(200).optional(),
});

export const checkinSubmissionSchema = z
  .object({
    questionnaireVersion: z.literal(QUESTIONNAIRE_VERSION),
    overallStatus: z.enum(overallStatuses),
    issueStatus: z.enum(issueStatuses).optional(),
    positivePoints: z.array(z.enum(positivePointValues)).max(7),
    issues: z.array(issueSchema).max(3),
    disclosurePreference: z.enum(disclosurePreferences).optional(),
    contactMethod: z.enum(contactMethods).optional(),
    contactWindow: z.enum(contactWindows).optional(),
    safety: z
      .object({
        immediateDanger: z.enum(immediateDangerValues),
        safeToContact: z.enum(safeToContactValues),
        safeLocation: z.enum(safeLocationValues),
      })
      .optional(),
    questionSnapshot: z.record(z.string(), z.unknown()),
  })
  .superRefine((value, context) => {
    const positivePath = value.issueStatus === "NO_ISSUE";
    const safetyPath = value.overallStatus === "NEED_HELP_NOW" || value.safety !== undefined;

    if (!value.issueStatus && !safetyPath) {
      context.addIssue({
        code: "custom",
        path: ["issueStatus"],
        message: "불편 발생 여부를 선택해 주세요.",
      });
    }

    if (positivePath && value.positivePoints.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["positivePoints"],
        message: "괜찮았던 점을 하나 이상 선택해 주세요.",
      });
    }

    if (!positivePath && !safetyPath && value.issues.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["issues"],
        message: "불편 항목을 하나 이상 입력해 주세요.",
      });
    }

    value.issues.forEach((issue, index) => {
      if (!isValidSubcategory(issue.category, issue.subcategory)) {
        context.addIssue({
          code: "custom",
          path: ["issues", index, "subcategory"],
          message: "선택한 불편 항목과 세부 항목이 일치하지 않습니다.",
        });
      }
      if (
        requiresClarificationPreference(issue.category, issue.subcategory) &&
        !issue.clarificationPreference
      ) {
        context.addIssue({
          code: "custom",
          path: ["issues", index, "clarificationPreference"],
          message: "추가 설명 방법을 선택해 주세요.",
        });
      }
    });

    const exclusivePositive = value.positivePoints.includes("SKIP") ||
      value.positivePoints.includes("NO_SPECIAL_EVENT");
    if (exclusivePositive && value.positivePoints.length > 1) {
      context.addIssue({
        code: "custom",
        path: ["positivePoints"],
        message: "건너뛰기 또는 특별한 일 없음은 다른 항목과 함께 선택할 수 없습니다.",
      });
    }

    if (!positivePath && !safetyPath) {
      if (!value.disclosurePreference) {
        context.addIssue({
          code: "custom",
          path: ["disclosurePreference"],
          message: "전달 동의를 선택해 주세요.",
        });
      }
      if (!value.contactMethod) {
        context.addIssue({
          code: "custom",
          path: ["contactMethod"],
          message: "연락 방식을 선택해 주세요.",
        });
      } else if (value.contactMethod !== "NO_CONTACT" && !value.contactWindow) {
        context.addIssue({
          code: "custom",
          path: ["contactWindow"],
          message: "연락 시간을 선택해 주세요.",
        });
      }
    }

    const hasSafetyTrigger =
      value.overallStatus === "NEED_HELP_NOW" ||
      value.issues.some(
        (issue) =>
          issue.category === "SAFETY" ||
          issue.severity === 5 ||
          [
            "UNWANTED_PHYSICAL_CONTACT",
            "SEXUAL_REMARK_OR_BEHAVIOR",
            "PHYSICAL_THREAT_VIOLENCE",
            "AFRAID_TO_STAY",
          ].includes(issue.subcategory),
      );

    if (hasSafetyTrigger && !value.safety) {
      context.addIssue({
        code: "custom",
        path: ["safety"],
        message: "안전 확인 질문에 답해 주세요.",
      });
    }
  });

export const draftSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
});

export const supportCaseUpdateSchema = z.object({
  action: z.enum([
    "ACKNOWLEDGE",
    "ASSIGN",
    "KAKAO_PLANNED",
    "PHONE_COMPLETED",
    "RULE_GUIDANCE",
    "START_MEDIATION",
    "CONTRACT_CONSULT",
    "MONITOR",
    "RESOLVE",
    "CLOSE",
  ]),
  assignedAdminId: z.string().uuid().optional(),
  resolutionCode: z.string().trim().max(80).optional(),
  internalNote: z.string().trim().max(1000).optional(),
});
