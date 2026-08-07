import {
  QUESTIONNAIRE_VERSION,
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

export { QUESTIONNAIRE_VERSION };

export const MAX_ISSUES_PER_CHECKIN = 3 as const;

export interface QuestionOption<Value extends string | number = string> {
  readonly value: Value;
  readonly label: string;
  readonly description?: string;
  /** An exclusive option clears every other choice in a multi-select question. */
  readonly exclusive?: boolean;
  /** Selecting this option must immediately enter the safety flow. */
  readonly safetyTrigger?: boolean;
  /** Metadata for risk evaluation; branching itself does not assign a risk level. */
  readonly riskCandidateLevel?: "ORANGE" | "RED";
}

export const questionnaireNotices = {
  privacy:
    "응답은 홈투게더 운영팀이 먼저 확인합니다.\n함께 거주하는 상대방에게 답변이 자동으로 전달되지는 않습니다.",
  nonPunitive:
    "이 설문은 공동생활 상태를 확인하고 필요한 지원을 제공하기 위한 것입니다.\n응답 내용만으로 계약 변경, 제재 또는 퇴거가 자동 결정되지 않습니다.",
  disclosure:
    "이름을 밝히지 않더라도 공동생활 특성상 상대방이 응답자를 추정할 수 있습니다.",
  safetyCompletion:
    "긴급한 상황에서는 설문 응답만 기다리지 말고 긴급기관 또는 홈투게더 긴급 연락처를 이용해 주세요.",
} as const;

export const overallStatusOptions = [
  { value: "VERY_GOOD", label: "매우 편안하게 지내고 있어요" },
  { value: "GOOD", label: "대체로 괜찮아요" },
  { value: "SLIGHTLY_UNCOMFORTABLE", label: "조금 불편한 점이 있어요" },
  { value: "VERY_UNCOMFORTABLE", label: "많이 불편해요" },
  {
    value: "NEED_HELP_NOW",
    label: "지금 도움이 필요해요",
    safetyTrigger: true,
    riskCandidateLevel: "RED",
  },
] as const satisfies readonly QuestionOption<OverallStatus>[];

export const issueStatusOptions = [
  { value: "NO_ISSUE", label: "특별한 불편은 없었어요" },
  { value: "RESOLVED", label: "불편했지만 이미 해결됐어요" },
  { value: "UNRESOLVED", label: "아직 해결되지 않은 불편이 있어요" },
  { value: "REPEATED", label: "같은 문제가 반복되고 있어요" },
  { value: "WORSENING", label: "이전보다 더 불편해지고 있어요" },
] as const satisfies readonly QuestionOption<IssueStatus>[];

export const positivePointOptions = [
  { value: "PRIVACY_RESPECTED", label: "사생활과 개인 경계가 잘 존중됐어요" },
  { value: "COMMUNICATION_GOOD", label: "대화와 소통이 원활했어요" },
  { value: "CLEANLINESS_GOOD", label: "청소와 위생 상태가 괜찮았어요" },
  { value: "RULES_FOLLOWED", label: "생활규칙과 약속이 잘 지켜졌어요" },
  { value: "SHARED_SPACE_GOOD", label: "공용공간을 편하게 사용했어요" },
  {
    value: "NO_SPECIAL_EVENT",
    label: "특별한 일은 없었어요",
    exclusive: true,
  },
  { value: "SKIP", label: "건너뛸게요", exclusive: true },
] as const satisfies readonly QuestionOption<PositivePoint>[];

export const issueCategoryOptions = [
  { value: "CLEANLINESS", label: "청소·위생" },
  { value: "SHARED_SPACE", label: "공용공간·사용시간" },
  { value: "NOISE_SLEEP", label: "소음·수면" },
  { value: "HOUSE_RULES", label: "생활규칙·약속" },
  { value: "PRIVACY_BOUNDARY", label: "사생활·개인 경계" },
  { value: "COMMUNICATION", label: "대화·관계" },
  { value: "CARE_PRESSURE", label: "생활지원·돌봄 요청 부담" },
  { value: "PAYMENT_CONTRACT", label: "비용·계약" },
  { value: "FACILITY_REPAIR", label: "시설·수리" },
  {
    value: "SAFETY",
    label: "안전·위협",
    safetyTrigger: true,
    riskCandidateLevel: "RED",
  },
  { value: "UNKNOWN", label: "어느 항목인지 잘 모르겠어요" },
] as const satisfies readonly QuestionOption<IssueCategory>[];

const cleanlinessSubcategories = [
  { value: "BATHROOM_CLEANING", label: "욕실 청소" },
  { value: "KITCHEN_CLEANING", label: "주방 청소" },
  { value: "DISHES", label: "설거지" },
  { value: "FOOD_WASTE", label: "음식물 쓰레기" },
  { value: "RECYCLING", label: "분리배출" },
  { value: "LAUNDRY_AREA", label: "세탁 공간 정리·청결" },
  { value: "COMMON_AREA", label: "공용공간 청소" },
  { value: "ODOR_VENTILATION", label: "냄새·환기" },
  { value: "MOLD_PEST", label: "곰팡이·해충" },
  { value: "FRIDGE_FOOD", label: "냉장고 음식 보관·정리" },
  {
    value: "PRIVATE_ROOM_HYGIENE_IMPACT",
    label: "개인 방의 위생 상태가 공동생활에 미치는 영향",
  },
  { value: "OTHER_CLEANLINESS", label: "기타 청소·위생 문제" },
] as const satisfies readonly QuestionOption[];

const sharedSpaceSubcategories = [
  { value: "BATHROOM_TIME", label: "욕실 사용 시간" },
  { value: "KITCHEN_TIME", label: "주방 사용 시간" },
  { value: "WASHING_MACHINE", label: "세탁기 사용" },
  { value: "REFRIGERATOR_STORAGE", label: "냉장고 보관 공간" },
  { value: "LIVING_ROOM", label: "거실 사용" },
  { value: "ENTRANCE_SHOE_STORAGE", label: "현관·신발 보관" },
  { value: "HEATING_COOLING", label: "냉난방 사용" },
  { value: "SHARED_ITEMS", label: "공용 물품 사용" },
  {
    value: "PERMISSION_BURDEN",
    label: "공용공간이나 물품을 사용할 때 허락을 구해야 하는 부담",
  },
  { value: "TIME_CONFLICT", label: "사용 시간 충돌" },
  { value: "OTHER_SHARED_SPACE", label: "기타 공용공간·사용시간 문제" },
] as const satisfies readonly QuestionOption[];

const noiseSleepSubcategories = [
  { value: "TV_MUSIC", label: "TV·음악 소리" },
  { value: "PHONE_VIDEO_CALL", label: "전화·영상통화 소리" },
  { value: "LATE_CONVERSATION", label: "늦은 시간 대화 소리" },
  { value: "FOOTSTEP_LIVING_NOISE", label: "발걸음·생활 소음" },
  { value: "DOOR_NOISE", label: "문 여닫는 소리" },
  { value: "ALARM", label: "알람 소리" },
  { value: "VISITOR_NOISE", label: "방문객 소음" },
  { value: "EARLY_MORNING_NOISE", label: "이른 아침 소음" },
  { value: "DIFFERENT_SLEEP_SCHEDULE", label: "서로 다른 수면 시간대" },
  { value: "OTHER_NOISE", label: "기타 소음·수면 문제" },
] as const satisfies readonly QuestionOption[];

const houseRulesSubcategories = [
  { value: "CLEANING_SCHEDULE", label: "청소 일정" },
  { value: "QUIET_HOURS", label: "조용히 해야 하는 시간" },
  { value: "KITCHEN_BATHROOM_TIME", label: "주방·욕실 사용 시간" },
  { value: "VISITOR", label: "방문객 규칙" },
  { value: "OVERNIGHT_GUEST", label: "외부인 숙박" },
  { value: "SMOKING_DRINKING", label: "흡연·음주" },
  { value: "PET", label: "반려동물" },
  { value: "LATE_RETURN_NOTICE", label: "늦은 귀가 사전 알림" },
  { value: "SHARED_ITEM_RULE", label: "공용 물품 사용 규칙" },
  { value: "HEATING_COOLING_RULE", label: "냉난방 사용 규칙" },
  { value: "WASTE_RULE", label: "쓰레기 배출 규칙" },
  { value: "NEW_UNAGREED_RULE", label: "합의하지 않은 새 규칙" },
  { value: "UNILATERAL_RULE_CHANGE", label: "일방적인 규칙 변경" },
  { value: "OTHER_RULE", label: "기타 생활규칙·약속 문제" },
] as const satisfies readonly QuestionOption[];

const privacyBoundarySubcategories = [
  {
    value: "ROOM_ENTRY_WITHOUT_PERMISSION",
    label: "허락 없이 방에 들어옴",
    riskCandidateLevel: "ORANGE",
  },
  { value: "BELONGINGS_TOUCHED", label: "개인 물건을 허락 없이 만짐" },
  { value: "SCHEDULE_QUESTIONING", label: "개인 일정에 대한 지나친 질문" },
  { value: "LOCATION_MONITORING", label: "위치를 확인하거나 감시함" },
  { value: "EXCESSIVE_CONTACT", label: "연락을 지나치게 자주 함" },
  { value: "PRIVATE_QUESTIONS", label: "답하기 불편한 사적인 질문" },
  { value: "PERSONAL_COMMENTS", label: "개인적인 평가나 불편한 말" },
  { value: "DOOR_OPEN_REQUEST", label: "방 문을 열어 두라고 요구함" },
  { value: "LOCK_KEY_ISSUE", label: "방문 잠금장치·열쇠 문제" },
  {
    value: "CAMERA_RECORDING_CONCERN",
    label: "카메라·촬영·녹음이 걱정됨",
    riskCandidateLevel: "ORANGE",
  },
  {
    value: "UNWANTED_PHYSICAL_CONTACT",
    label: "원하지 않는 신체 접촉",
    safetyTrigger: true,
    riskCandidateLevel: "RED",
  },
  { value: "GENERAL_PRIVACY_CONCERN", label: "그 밖의 사생활·개인 경계 문제" },
] as const satisfies readonly QuestionOption[];

const communicationSubcategories = [
  { value: "UNCOMFORTABLE_TONE", label: "불편하게 느껴지는 말투" },
  { value: "REPEATED_NAGGING", label: "같은 지적이나 잔소리가 반복됨" },
  { value: "EXCESSIVE_INTERFERENCE", label: "생활에 지나치게 간섭함" },
  { value: "NO_RESPONSE", label: "말이나 연락에 응답하지 않음" },
  { value: "NO_ADVANCE_NOTICE", label: "필요한 일을 미리 알리지 않음" },
  { value: "AVOIDING_CONVERSATION", label: "대화를 피함" },
  { value: "FREQUENT_ARGUMENT", label: "말다툼이 자주 생김" },
  {
    value: "DIFFERENT_INTERACTION_EXPECTATION",
    label: "서로 기대하는 교류 방식이 다름",
  },
  { value: "TOO_MUCH_INTERACTION", label: "함께하는 시간이나 대화가 너무 많음" },
  { value: "TOO_LITTLE_COMMUNICATION", label: "필요한 대화나 소통이 너무 적음" },
  { value: "NO_RESOLUTION", label: "대화해도 문제가 해결되지 않음" },
  { value: "OTHER_COMMUNICATION", label: "기타 대화·관계 문제" },
] as const satisfies readonly QuestionOption[];

const carePressureSubcategories = [
  { value: "COOKING_REQUEST", label: "요리 요청" },
  { value: "HOUSEWORK_REQUEST", label: "집안일 요청" },
  { value: "SHOPPING_REQUEST", label: "장보기 요청" },
  { value: "ERRAND_REQUEST", label: "심부름 요청" },
  { value: "HOSPITAL_BANK_COMPANION", label: "병원·은행 등에 함께 가 달라는 요청" },
  { value: "MEDICATION_HEALTH_SUPPORT", label: "복약·건강 관리를 도와 달라는 요청" },
  { value: "DIGITAL_SUPPORT", label: "휴대전화·인터넷 등 디지털 사용 도움 요청" },
  { value: "ADMIN_SUPPORT", label: "서류·행정 업무 도움 요청" },
  { value: "EMOTIONAL_SUPPORT", label: "지속적인 정서적 위로·상담 요청" },
  {
    value: "FAMILY_REPLACEMENT_CHECKIN",
    label: "가족을 대신하듯 자주 안부를 확인해 달라는 요청",
  },
  { value: "MONEY_REQUEST", label: "돈을 빌려 달라는 요청" },
  { value: "PURCHASE_REQUEST", label: "물건을 대신 사 달라는 요청" },
  { value: "REPEATED_AFTER_REFUSAL", label: "거절한 뒤에도 같은 요청이 반복됨" },
  { value: "OTHER_CARE_PRESSURE", label: "기타 생활지원·돌봄 요청 부담" },
] as const satisfies readonly QuestionOption[];

const paymentContractSubcategories = [
  { value: "RENT", label: "월세" },
  { value: "DEPOSIT", label: "보증금" },
  { value: "UTILITY", label: "공과금" },
  { value: "MAINTENANCE_FEE", label: "관리비" },
  { value: "SHARED_SUPPLIES", label: "공용 생활용품 비용" },
  { value: "COST_SPLIT", label: "비용 분담" },
  { value: "PAYMENT_DATE_METHOD", label: "납부 날짜·방법" },
  { value: "CONTRACT_PERIOD", label: "계약 기간" },
  { value: "MOVE_IN_OUT_DATE", label: "입주·퇴실 날짜" },
  { value: "DIFFERENT_FROM_DESCRIPTION", label: "사전에 들은 내용과 실제 조건이 다름" },
  { value: "UNILATERAL_CONTRACT_CHANGE", label: "일방적인 계약 조건 변경" },
  { value: "ADDITIONAL_COST", label: "사전에 안내받지 못한 추가 비용" },
  { value: "OTHER_PAYMENT_CONTRACT", label: "기타 비용·계약 문제" },
] as const satisfies readonly QuestionOption[];

const facilityRepairSubcategories = [
  { value: "PRIVATE_ROOM_FURNITURE", label: "개인 방·가구" },
  { value: "DOOR_LOCK", label: "문·잠금장치" },
  { value: "BATHROOM", label: "욕실 시설" },
  { value: "KITCHEN", label: "주방 시설" },
  { value: "WASHING_MACHINE", label: "세탁기" },
  { value: "REFRIGERATOR", label: "냉장고" },
  { value: "HEATING_COOLING", label: "냉난방" },
  { value: "HOT_WATER", label: "온수" },
  { value: "WATER", label: "수도" },
  { value: "ELECTRICITY_LIGHT", label: "전기·조명" },
  { value: "GAS", label: "가스" },
  { value: "INTERNET", label: "인터넷" },
  { value: "MOLD_LEAK", label: "곰팡이·누수" },
  { value: "FIRE_GAS_SAFETY", label: "화재·가스 안전 설비" },
  { value: "REPAIR_DELAY", label: "수리 요청이 지연됨" },
  { value: "OTHER_FACILITY", label: "기타 시설·수리 문제" },
] as const satisfies readonly QuestionOption[];

const safetySubcategories = [
  {
    value: "SEXUAL_REMARK_OR_BEHAVIOR",
    label: "성적인 말이나 행동",
    safetyTrigger: true,
    riskCandidateLevel: "RED",
  },
  {
    value: "UNWANTED_PHYSICAL_CONTACT",
    label: "원하지 않는 신체 접촉",
    safetyTrigger: true,
    riskCandidateLevel: "RED",
  },
  { value: "YELLING_THREAT", label: "고함·협박" },
  {
    value: "PHYSICAL_THREAT_VIOLENCE",
    label: "신체적 위협이나 폭력",
    safetyTrigger: true,
    riskCandidateLevel: "RED",
  },
  { value: "THROWING_BREAKING_OBJECTS", label: "물건을 던지거나 부숨" },
  { value: "STALKING_MONITORING", label: "따라다니거나 감시함" },
  { value: "INTOXICATED_THREAT", label: "술이나 약물에 취한 상태에서 위협함" },
  { value: "UNAUTHORIZED_VISITOR", label: "동의하지 않은 방문객 출입" },
  { value: "THEFT_SUSPECTED", label: "도난이 의심됨" },
  { value: "FIRE_GAS_ELECTRIC_RISK", label: "화재·가스·전기 위험" },
  {
    value: "AFRAID_TO_STAY",
    label: "집에 머무는 것이 두려움",
    safetyTrigger: true,
    riskCandidateLevel: "RED",
  },
  { value: "GENERAL_UNSAFE_FEELING", label: "전반적으로 안전하지 않다고 느낌" },
] as const satisfies readonly QuestionOption[];

const unknownSubcategories = [
  { value: "UNKNOWN", label: "어느 항목인지 잘 모르겠어요" },
] as const satisfies readonly QuestionOption[];

/**
 * Category-scoped options intentionally allow repeated values such as
 * WASHING_MACHINE. A stored issue is interpreted by the category/value pair.
 */
export const issueSubcategoryOptions = {
  CLEANLINESS: cleanlinessSubcategories,
  SHARED_SPACE: sharedSpaceSubcategories,
  NOISE_SLEEP: noiseSleepSubcategories,
  HOUSE_RULES: houseRulesSubcategories,
  PRIVACY_BOUNDARY: privacyBoundarySubcategories,
  COMMUNICATION: communicationSubcategories,
  CARE_PRESSURE: carePressureSubcategories,
  PAYMENT_CONTRACT: paymentContractSubcategories,
  FACILITY_REPAIR: facilityRepairSubcategories,
  SAFETY: safetySubcategories,
  UNKNOWN: unknownSubcategories,
} as const satisfies Record<IssueCategory, readonly QuestionOption[]>;

export const frequencyOptions = [
  { value: "ONCE", label: "한 번 있었어요" },
  { value: "TWO_OR_THREE", label: "두세 번 있었어요" },
  { value: "SEVERAL_TIMES", label: "여러 번 있었어요" },
  { value: "ALMOST_DAILY", label: "거의 매일 있었어요" },
  { value: "ONGOING", label: "계속 이어지고 있어요" },
  { value: "UNKNOWN", label: "횟수를 잘 모르겠어요" },
] as const satisfies readonly QuestionOption<Frequency>[];

export const severityOptions = [
  { value: 1, label: "거의 신경 쓰이지 않는 정도예요" },
  { value: 2, label: "조금 불편하지만 지낼 수 있어요" },
  {
    value: 3,
    label: "꽤 불편하고, 반복되면 계속 지내기 어려울 것 같아요",
  },
  { value: 4, label: "현재 생활에 큰 지장을 주고 있어요" },
  {
    value: 5,
    label: "더 이상 함께 지내기 어렵거나 안전이 걱정돼요",
    safetyTrigger: true,
    riskCandidateLevel: "RED",
  },
] as const satisfies readonly QuestionOption<1 | 2 | 3 | 4 | 5>[];

export const discussionStatusOptions = [
  { value: "NOT_DISCLOSED", label: "아직 이야기하지 않았어요" },
  { value: "DONT_KNOW_HOW", label: "어떻게 말해야 할지 모르겠어요" },
  { value: "DISCUSSED_RESOLVED", label: "이야기했고 해결됐어요" },
  { value: "DISCUSSED_UNRESOLVED", label: "이야기했지만 해결되지 않았어요" },
  { value: "WORSENED_AFTER_DISCUSSION", label: "이야기한 뒤 오히려 더 불편해졌어요" },
  { value: "DIFFICULT_TO_DISCUSS", label: "직접 이야기하기 어려운 문제예요" },
] as const satisfies readonly QuestionOption<DiscussionStatus>[];

export const desiredActionOptions = [
  { value: "RECORD_ONLY", label: "조치 없이 기록만 남겨주세요" },
  { value: "COMMUNICATION_GUIDE", label: "제가 어떻게 이야기하면 좋을지 알려주세요" },
  { value: "RULE_REMINDER_TO_BOTH", label: "양쪽 모두에게 생활규칙을 다시 안내해 주세요" },
  {
    value: "ANONYMOUS_SUMMARY",
    label: "상대방에게 제 이름을 밝히지 않고 핵심만 전달해 주세요",
  },
  { value: "CHAT_MEDIATION", label: "홈투게더가 채팅으로 중재해 주세요" },
  { value: "PHONE_CONSULT", label: "운영팀과 전화로 상담하고 싶어요" },
  { value: "CONTRACT_REVIEW", label: "계약 조건을 다시 확인하고 싶어요" },
  {
    value: "RELOCATION_EXIT_CONSULT",
    label: "방 변경·퇴실 등 거주 대안을 상담하고 싶어요",
  },
  { value: "URGENT_CONTACT", label: "가능한 한 빨리 연락해 주세요" },
] as const satisfies readonly QuestionOption<DesiredAction>[];

export const disclosurePreferenceOptions = [
  { value: "OPS_ONLY", label: "우선 홈투게더 운영팀만 확인해 주세요" },
  {
    value: "CONTACT_BEFORE_SHARE",
    label: "저에게 먼저 연락한 뒤 전달 여부를 정하고 싶어요",
  },
  {
    value: "SUMMARY_WITHOUT_NAME",
    label: "제 이름을 밝히지 않고 핵심 내용만 전달해도 돼요",
  },
  { value: "SHARE_WITH_NAME", label: "제 이름과 함께 내용을 전달해도 돼요" },
  { value: "DO_NOT_SHARE", label: "상대방에게 전달하지 말고 상담만 받고 싶어요" },
] as const satisfies readonly QuestionOption<DisclosurePreference>[];

export const contactMethodOptions = [
  { value: "KAKAO", label: "카카오톡" },
  { value: "PHONE", label: "전화" },
  { value: "SMS", label: "문자메시지" },
  { value: "NO_CONTACT", label: "연락을 원하지 않아요" },
] as const satisfies readonly QuestionOption<ContactMethod>[];

export const contactWindowOptions = [
  { value: "WEEKDAY_10_12", label: "평일 오전 10시~낮 12시" },
  { value: "WEEKDAY_12_15", label: "평일 낮 12시~오후 3시" },
  { value: "WEEKDAY_15_18", label: "평일 오후 3시~6시" },
  { value: "WEEKDAY_18_20", label: "평일 오후 6시~8시" },
  { value: "WEEKEND", label: "주말" },
  { value: "ANY_TIME", label: "언제든 괜찮아요" },
  { value: "NOW", label: "지금 연락해 주세요" },
] as const satisfies readonly QuestionOption<ContactWindow>[];

export const clarificationPreferenceOptions = [
  { value: "CONTACT_TO_EXPLAIN", label: "운영팀이 연락하면 설명하겠습니다" },
  {
    value: "RECORD_WITHOUT_DETAILS",
    label: "별도 설명 없이 기록만 남기겠습니다",
  },
] as const satisfies readonly QuestionOption<ClarificationPreference>[];

export const immediateDangerOptions = [
  {
    value: "IMMEDIATE_DANGER",
    label: "네, 현재 즉시 위험해요",
    safetyTrigger: true,
    riskCandidateLevel: "RED",
  },
  {
    value: "CONCERNED_BUT_NOT_IMMEDIATE",
    label: "걱정되지만 지금 당장 위험한 상황은 아니에요",
  },
  { value: "NOT_IMMEDIATE", label: "아니요, 현재 즉시 위험하지는 않아요" },
  { value: "UNSURE", label: "잘 모르겠어요" },
] as const satisfies readonly QuestionOption<ImmediateDanger>[];

export const safeToContactOptions = [
  { value: "PHONE_OK_NOW", label: "지금 전화해도 괜찮아요" },
  { value: "KAKAO_ONLY", label: "카카오톡으로만 연락해 주세요" },
  { value: "SMS_ONLY", label: "문자로만 연락해 주세요" },
  { value: "NOT_SAFE_TO_CONTACT_NOW", label: "지금은 연락받는 것이 안전하지 않아요" },
  { value: "CONTACT_LATER", label: "나중에 연락해 주세요" },
] as const satisfies readonly QuestionOption<SafeToContact>[];

export const safeLocationOptions = [
  { value: "YES", label: "네, 안전한 공간에 있어요" },
  { value: "NO", label: "아니요, 안전한 공간에 있지 않아요" },
  { value: "UNSURE", label: "잘 모르겠어요" },
  { value: "PREFER_NOT_TO_ANSWER", label: "답변하고 싶지 않아요" },
] as const satisfies readonly QuestionOption<SafeLocation>[];

export const additionalIssueOptions = [
  { value: "NO", label: "추가로 불편한 점은 없어요" },
  { value: "YES", label: "다른 불편한 점도 있어요" },
] as const satisfies readonly QuestionOption<"YES" | "NO">[];

export const SAFETY_TRIGGER_OVERALL_STATUSES = ["NEED_HELP_NOW"] as const satisfies readonly OverallStatus[];
export const SAFETY_TRIGGER_CATEGORIES = ["SAFETY"] as const satisfies readonly IssueCategory[];
export const SAFETY_TRIGGER_SEVERITIES = [5] as const;
export const SAFETY_TRIGGER_SUBCATEGORIES = [
  "UNWANTED_PHYSICAL_CONTACT",
  "SEXUAL_REMARK_OR_BEHAVIOR",
  "PHYSICAL_THREAT_VIOLENCE",
  "AFRAID_TO_STAY",
] as const;

export const questionnaireQuestions = {
  overallStatus: {
    id: "overallStatus",
    title: "전반적인 공동생활 상태",
    prompt: "이번 주 공동생활은 전반적으로 어떠셨나요?",
    selection: "single",
    options: overallStatusOptions,
  },
  issueStatus: {
    id: "issueStatus",
    title: "불편 발생 여부",
    prompt: "이번 주에 공동생활에서 불편한 점이 있었나요?",
    selection: "single",
    options: issueStatusOptions,
  },
  positivePoints: {
    id: "positivePoints",
    title: "괜찮았던 점",
    prompt: "이번 주 공동생활에서 괜찮았던 점이 있다면 선택해 주세요.",
    selection: "multiple",
    options: positivePointOptions,
  },
  issueCategory: {
    id: "issueCategory",
    title: "가장 먼저 해결하고 싶은 항목",
    prompt: "불편한 점 중 가장 먼저 해결하고 싶은 항목 하나를 선택해 주세요.",
    selection: "single",
    options: issueCategoryOptions,
  },
  issueSubcategory: {
    id: "issueSubcategory",
    title: "세부 불편 항목",
    prompt: "어떤 점이 가장 불편했는지 하나를 선택해 주세요.",
    selection: "single",
    optionsByCategory: issueSubcategoryOptions,
  },
  clarificationPreference: {
    id: "clarificationPreference",
    title: "추가 설명 방법",
    prompt: "선택하신 항목을 어떻게 남길까요?",
    selection: "single",
    options: clarificationPreferenceOptions,
  },
  frequency: {
    id: "frequency",
    title: "발생 빈도",
    prompt: "이번 주에 이 문제가 얼마나 자주 있었나요?",
    selection: "single",
    options: frequencyOptions,
  },
  severity: {
    id: "severity",
    title: "생활 영향도",
    prompt: "이 문제가 현재 생활에 어느 정도 영향을 주고 있나요?",
    selection: "single",
    options: severityOptions,
  },
  discussionStatus: {
    id: "discussionStatus",
    title: "상대방과 대화 여부",
    prompt: "이 문제에 대해 함께 거주하는 상대방과 이야기해 보셨나요?",
    selection: "single",
    options: discussionStatusOptions,
  },
  desiredAction: {
    id: "desiredAction",
    title: "원하는 지원",
    prompt: "홈투게더가 어떻게 도와드리면 좋을까요?",
    selection: "single",
    options: desiredActionOptions,
  },
  disclosurePreference: {
    id: "disclosurePreference",
    title: "전달 동의",
    prompt: "응답 내용을 상대방에게 전달하는 것에 대해 어떻게 생각하시나요?",
    description: questionnaireNotices.disclosure,
    selection: "single",
    options: disclosurePreferenceOptions,
  },
  contactMethod: {
    id: "contactMethod",
    title: "연락 방식",
    prompt: "운영팀의 연락이 필요하다면 어떤 방식이 편하신가요?",
    selection: "single",
    options: contactMethodOptions,
  },
  contactWindow: {
    id: "contactWindow",
    title: "연락 시간",
    prompt: "연락받기 편한 시간을 선택해 주세요.",
    selection: "single",
    options: contactWindowOptions,
  },
  additionalIssue: {
    id: "additionalIssue",
    title: "추가 불편",
    prompt: "추가로 남기고 싶은 불편한 점이 있나요?",
    selection: "single",
    options: additionalIssueOptions,
  },
  immediateDanger: {
    id: "immediateDanger",
    title: "현재 위험 여부",
    prompt: "현재 즉시 위험한 상황인가요?",
    selection: "single",
    options: immediateDangerOptions,
  },
  safeToContact: {
    id: "safeToContact",
    title: "안전한 연락 방법",
    prompt: "홈투게더가 지금 연락해도 안전한가요?",
    selection: "single",
    options: safeToContactOptions,
  },
  safeLocation: {
    id: "safeLocation",
    title: "현재 위치의 안전",
    prompt: "현재 안전한 공간에 계신가요?",
    selection: "single",
    options: safeLocationOptions,
  },
} as const;

/**
 * This is the canonical, JSON-serializable definition for this questionnaire
 * version. Persist a copy with the response so old answers remain interpretable.
 */
export const WEEKLY_CHECKIN_QUESTIONNAIRE = {
  version: QUESTIONNAIRE_VERSION,
  maxIssues: MAX_ISSUES_PER_CHECKIN,
  notices: questionnaireNotices,
  questions: questionnaireQuestions,
  rules: {
    safety: {
      overallStatuses: SAFETY_TRIGGER_OVERALL_STATUSES,
      categories: SAFETY_TRIGGER_CATEGORIES,
      severities: SAFETY_TRIGGER_SEVERITIES,
      subcategories: SAFETY_TRIGGER_SUBCATEGORIES,
    },
    clarification: {
      categories: ["UNKNOWN"],
      exactSubcategories: ["UNKNOWN"],
      subcategoryPrefixes: ["OTHER_"],
    },
  },
} as const;

export const QUESTION_TREE = WEEKLY_CHECKIN_QUESTIONNAIRE;
export const QUESTIONNAIRE_SNAPSHOT = WEEKLY_CHECKIN_QUESTIONNAIRE;

export function createQuestionnaireSnapshot(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(WEEKLY_CHECKIN_QUESTIONNAIRE)) as Record<string, unknown>;
}

export function getSubcategoryOptions(
  category: IssueCategory,
): readonly QuestionOption<string>[] {
  return issueSubcategoryOptions[category];
}
