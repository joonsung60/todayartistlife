import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '소개 | 투아라 (Today Artist Life)',
  description: '해외 아티스트/연예인들의 생생한 라이프, 가십, 스토리를 전하는 한국인 대상 전문 미디어입니다.',
}

export default function AboutPage() {
  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight mb-10">
          투아라 (Today Artist Life)는
        </h1>

        <div className="text-base leading-relaxed text-zinc-800 space-y-6">
          <p>
            해외 팝, 케이팝, 그리고 다양한 장르를 넘나드는 글로벌 아티스트들의 라이프, 가십, 비하인드 스토리를 전하는 미디어입니다.
          </p>

          <p>
            무대 위 화려한 모습뿐만 아니라, 그 이면의 일상과 흥미로운 에피소드들을 한국어로 쉽고 빠르게 접할 수 있도록 기획되었습니다. 음악 산업 트렌드부터 아티스트 개인의 인간적인 매력까지 폭넓게 다룹니다.
          </p>

          <p>
            단순한 정보 전달을 넘어 아티스트들의 다채로운 삶과 이야기를 가장 생생하게 기록해 나갑니다.
          </p>
        </div>

        <dl className="mt-16 pt-8 border-t border-zinc-200 space-y-3 text-sm">
          <div className="flex gap-4">
            <dt className="w-28 shrink-0 text-zinc-500">발행인 · 편집인</dt>
            <dd className="text-zinc-800 font-medium">곽준성</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-28 shrink-0 text-zinc-500">문의</dt>
            <dd>
              <a
                href="mailto:gwakjoonsung@gmail.com"
                className="text-zinc-800 hover:underline"
              >
                gwakjoonsung@gmail.com
              </a>
            </dd>
          </div>
        </dl>
      </main>
    </div>
  )
}
