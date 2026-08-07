import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  EyeOff,
  FileClock,
  LifeBuoy,
  ListChecks,
  ShieldCheck,
} from "lucide-react";

export const metadata: Metadata = {
  title: "주간 체크인 개인정보 및 응답 처리 안내",
  description: "홈투게더 공동생활 주간 체크인의 개인정보 수집 및 응답 처리 기준",
};

const privacyContact = process.env.PRIVACY_CONTACT_EMAIL?.trim();

function InfoCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#dce5e1] bg-white p-5 shadow-[0_10px_32px_rgba(30,65,52,0.05)] sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e7f3ed] text-[#176b52]">
          {icon}
        </span>
        <h2 className="m-0 text-xl font-black tracking-[-0.03em]">{title}</h2>
      </div>
      <div className="text-[15px] leading-7 text-[#53645d]">{children}</div>
    </section>
  );
}

export default function CheckinPrivacyPage() {
  return (
    <main className="min-h-screen bg-[#f4f7f5] px-5 py-8 text-[#17211d] sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <Link
          href="/"
          className="mb-6 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-bold text-[#405149] no-underline outline-none hover:bg-white focus-visible:ring-4 focus-visible:ring-[#176b52]/15"
        >
          <ArrowLeft size={17} aria-hidden="true" /> 홈으로
        </Link>

        <header className="mb-7 rounded-3xl bg-[#143f32] p-6 text-white shadow-[0_20px_50px_rgba(20,63,50,0.2)] sm:p-9">
          <p className="mb-3 text-sm font-extrabold tracking-[0.1em] text-[#bfe7d6]">
            HOMETOGETHER PRIVACY
          </p>
          <h1 className="m-0 text-3xl font-black tracking-[-0.04em] sm:text-4xl">
            주간 체크인 개인정보 및 응답 처리 안내
          </h1>
          <p className="mb-0 mt-4 max-w-2xl text-[15px] leading-7 text-[#e0eee8] sm:text-base">
            응답 전에 수집 범위와 처리 방법을 확인해 주세요. 홈투게더는 공동생활 상태 확인과
            필요한 지원을 위해 최소한의 정보만 수집합니다.
          </p>
        </header>

        <div className="grid gap-4">
          <InfoCard icon={<ShieldCheck size={21} />} title="수집 목적과 이용 목적">
            <p className="m-0">
              매주 공동생활 상태를 확인하고, 반복되는 불편이나 안전 신호를 발견하며, 응답자가
              요청한 상담·중재·생활 안내 등 후속 지원을 제공하기 위해 이용합니다. 체크인 응답을
              광고나 제3자의 마케팅 목적으로 이용하지 않습니다.
            </p>
          </InfoCard>

          <InfoCard icon={<ListChecks size={21} />} title="수집 항목과 필수·선택 구분">
            <ul className="m-0 grid gap-2 pl-5">
              <li>
                <b className="text-[#27332e]">필수:</b> 초대 식별정보(원문이 저장되지 않는 개인
                링크 토큰), 응답자 역할과 주차, 전반적 상태, 선택한 설문 분기에 필요한 답변,
                제출 시각
              </li>
              <li>
                <b className="text-[#27332e]">상황에 따라 필수:</b> 불편 유형·빈도·생활 영향·원하는
                지원, 안전 분기에서의 즉시 위험 여부와 안전한 연락 조건
              </li>
              <li>
                <b className="text-[#27332e]">선택:</b> 괜찮았던 점, 추가 불편, 연락 선호 방식과
                시간대, 응답 전달 범위
              </li>
              <li>
                <b className="text-[#27332e]">보안 목적:</b> 과도한 요청을 막기 위한 IP 기반
                일방향 HMAC 버킷. 원문 IP는 체크인 응답에 저장하지 않습니다.
              </li>
            </ul>
          </InfoCard>

          <InfoCard icon={<EyeOff size={21} />} title="누가 확인하며, 누구에게 공유되나요?">
            <p className="m-0">
              승인된 홈투게더 운영팀만 권한에 따라 응답을 확인합니다. 함께 거주하는 상대방에게
              답변이나 위험도, 안전 알림이 자동으로 공유되지 않습니다. 전달이 필요한 경우에도
              응답자가 선택한 전달 범위를 먼저 확인합니다.
            </p>
          </InfoCard>

          <InfoCard icon={<LifeBuoy size={21} />} title="안전 문제와 운영팀 연락">
            <p className="m-0">
              즉시 위험하거나 안전이 우려되는 답변은 운영팀의 긴급 확인 목록에 표시될 수 있으며,
              운영팀은 응답자가 남긴 안전한 연락 방식과 시간에 맞춰 연락할 수 있습니다. 체크인은
              긴급 구조 서비스가 아닙니다. 즉각적인 위험이 있다면 안전한 장소로 이동하고 112 또는
              119 등 긴급기관에 먼저 연락해 주세요.
            </p>
          </InfoCard>

          <InfoCard icon={<FileClock size={21} />} title="보관과 삭제 기준">
            <p className="m-0">
              응답은 공동생활 지원, 사건 처리 및 관련 운영상 책임을 이행하는 동안 보관합니다.
              목적이 달성되고 관계 법령·분쟁 대응 등 별도 보존 사유가 해소되면 안전하게 삭제하거나
              개인을 알아볼 수 없도록 처리합니다. 삭제 요청이 접수되면 본인 확인과 법적 보존 필요
              여부를 검토한 뒤 처리 결과를 안내합니다.
            </p>
          </InfoCard>

          <InfoCard icon={<CheckCircle2 size={21} />} title="문의 및 열람·삭제 요청">
            <p className="m-0">
              응답 열람, 정정 또는 삭제를 요청하려면 본인 확인이 가능한 정보와 요청 내용을
              홈투게더 운영팀에 보내 주세요.
            </p>
            <p className="mb-0 mt-3 rounded-xl bg-[#f3f7f5] p-4 font-semibold text-[#27332e]">
              {privacyContact ? (
                <>
                  문의 이메일: <a className="underline" href={`mailto:${privacyContact}`}>{privacyContact}</a>
                </>
              ) : (
                "문의 방법: 체크인 알림을 받은 홈투게더 공식 카카오톡 채널 또는 서비스 문의 창구"
              )}
            </p>
          </InfoCard>
        </div>

        <p className="mb-0 mt-7 text-center text-sm leading-6 text-[#718078]">
          마지막 업데이트: 2026년 8월 7일
        </p>
      </div>
    </main>
  );
}
