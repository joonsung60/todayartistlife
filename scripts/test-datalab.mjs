const CLIENT_ID = process.env.NAVER_DATALAB_CLIENT_ID
const CLIENT_SECRET = process.env.NAVER_DATALAB_CLIENT_SECRET

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('환경변수 누락: NAVER_DATALAB_CLIENT_ID, NAVER_DATALAB_CLIENT_SECRET')
  process.exit(1)
}

const TEST_ENTITIES = [
  { korean_name: '테일러 스위프트' },
  { korean_name: '비욘세' },
  { korean_name: '아리아나 그란데' },
  { korean_name: 'BTS' },
  { korean_name: '셀레나 고메즈' },
]

const endDate = new Date()
const startDate = new Date()
startDate.setDate(endDate.getDate() - 28)
const fmt = (d) => d.toISOString().slice(0, 10)

const body = {
  startDate: fmt(startDate),
  endDate: fmt(endDate),
  timeUnit: 'week',
  keywordGroups: TEST_ENTITIES.map((e) => ({
    groupName: e.korean_name,
    keywords: [e.korean_name],
  })),
}

console.log('요청 기간:', body.startDate, '~', body.endDate)
console.log('쿼리:', TEST_ENTITIES.map(e => e.korean_name).join(', '))
console.log()

const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Naver-Client-Id': CLIENT_ID,
    'X-Naver-Client-Secret': CLIENT_SECRET,
  },
  body: JSON.stringify(body),
})

if (!res.ok) {
  const text = await res.text()
  console.error(`API 오류 [${res.status}]:`, text)
  process.exit(1)
}

const data = await res.json()

for (const result of data.results) {
  const values = result.data.map(d => d.ratio)
  const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)
  const max = Math.max(...values).toFixed(1)
  console.log(`${result.title.padEnd(15)} 평균: ${avg.padStart(5)}  최대: ${max.padStart(5)}`)
}
