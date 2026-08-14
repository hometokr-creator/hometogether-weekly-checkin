import type {
  LeadChurnReason,
  LeadChurnStage,
  LeadCustomerType,
  LeadOutcome,
  LeadSource,
  LeadStatus,
} from "@/lib/leads/types";

export const leadSourceLabels: Record<LeadSource, string> = {
  KAKAO: "카카오",
  EVERYTIME: "에브리타임",
  INSTAGRAM: "인스타그램",
  WEBSITE: "웹사이트",
  REFERRAL: "추천",
  ETC: "기타",
};

export const leadCustomerTypeLabels: Record<LeadCustomerType, string> = {
  GUEST: "입주 희망자",
  HOST: "호스트",
  GUEST_PARENT: "입주 희망자 보호자",
  HOST_CHILD: "호스트 자녀",
  UNKNOWN: "확인 필요",
};

export const leadStatusLabels: Record<LeadStatus, string> = {
  NEW: "신규 문의",
  CONTACTED: "응답 완료",
  VIEWING_REQUESTED: "방문 요청",
  VIEWING_CONFIRMED: "방문 확정",
  VIEWED: "방문 완료",
  REGISTERED: "등록",
  CHURNED: "이탈",
};

export const leadOutcomeLabels: Record<LeadOutcome, string> = {
  ONGOING: "진행 중",
  REGISTERED: "등록",
  CHURNED: "이탈",
};

export const leadChurnStageLabels: Record<LeadChurnStage, string> = {
  INQUIRY: "문의 후",
  VIEWING_SCHEDULED: "방문 예정",
  AFTER_VIEWING: "방문 후",
  AFTER_REGISTRATION: "등록 후",
};

export const leadChurnReasonLabels: Record<LeadChurnReason, string> = {
  RESPONSE_DELAY: "답변이 늦음",
  LISTING_CONDITION: "방 상태·조건",
  LOCATION: "위치",
  NO_INVENTORY: "원하는 지역 매물 없음",
  CONTRACT_TERM: "계약기간",
  PRICE: "가격",
  DEPOSIT: "보증금",
  MOVE_IN_REGISTRATION: "전입신고",
  KITCHEN: "주방",
  CURFEW: "통금",
  HOST_INFO: "호스트·동거 정보",
  FAMILY_OPPOSITION: "가족 반대",
  OTHER_PROPERTY: "다른 집 계약",
  PERSONAL_REASON: "개인 사유",
  UNKNOWN: "확인 필요",
};
