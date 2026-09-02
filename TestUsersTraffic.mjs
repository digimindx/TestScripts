// capacity-test.mjs
import { fetch } from 'node:http';
import { performance } from 'perf_hooks';

const CONFIG = {
  url: 'http://localhost:3000/api/login',
  payload: { username: 'testuser', password: 'pass123' },
  initialRps: 5,
  maxRps: 100,
  stepRps: 10,
  phaseDuration: 15,      // مدة كل مرحلة بالثواني
  concurrency: 20         // أقصى طلبات متزامنة في نفس اللحظة
};

async function runCapacityTest() {
  let currentRps = CONFIG.initialRps;
  const results = [];

  console.log(`🚀 بدء اختبار القدرة على: ${CONFIG.url}`);
  console.log(`📌 الإعدادات: RPS من ${CONFIG.initialRps} إلى ${CONFIG.maxRps} | مرحلة كل ${CONFIG.phaseDuration}ث | التزامن ${CONFIG.concurrency}\n`);

  while (currentRps <= CONFIG.maxRps) {
    console.log(`📊 جاري الاختبار عند ${currentRps} مستخدم/ثانية...`);
    const phaseStats = await runPhase(currentRps, CONFIG.phaseDuration, CONFIG.concurrency);
    results.push({ rps: currentRps, ...phaseStats });
    currentRps += CONFIG.stepRps;
  }

  printCapacityReport(results);
}

async function runPhase(targetRps, duration, maxConcurrent) {
  const totalRequests = Math.ceil(targetRps * duration);
  const intervalMs = 1000 / targetRps;
  let sent = 0;
  let success = 0;
  let failed = 0;
  const latencies = [];
  const phaseStart = performance.now();
  let active = 0;

  // جدولة الطلبات بدقة زمنية نسبية
  const schedule = () => {
    if (sent >= totalRequests || (performance.now() - phaseStart) >= duration * 1000) return;

    const nextTime = phaseStart + (sent * intervalMs);
    const wait = Math.max(0, nextTime - performance.now());

    setTimeout(() => {
      sent++;
      if (active < maxConcurrent) {
        active++;
        const reqStart = performance.now();
        fetch(CONFIG.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(CONFIG.payload)
        })
        .then(res => {
          if (res.ok) success++;
          else failed++;
        })
        .catch(() => failed++)
        .finally(() => {
          latencies.push(performance.now() - reqStart);
          active--;
          schedule();
        });
      } else {
        // إعادة الجدولة عند توفر مقعد
        setTimeout(schedule, 5);
      }
    }, wait);
  };

  schedule();

  // انتظار انتهاء المرحلة
  await new Promise(resolve => {
    const check = () => {
      if (sent >= totalRequests && active === 0) resolve();
      else setTimeout(check, 50);
    };
    check();
  });

  return { success, failed, latencies };
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function printCapacityReport(results) {
  console.log('\n📈 === تقرير قدرة الخادم ===');
  console.log('RPS\tAvg(ms)\tP50(ms)\tP95(ms)\tP99(ms)\tMax(ms)\tSuccess\tFailed\tError%');
  
  let breakingPoint = null;

  for (const r of results) {
    const avg = r.latencies.reduce((a, b) => a + b, 0) / r.latencies.length;
    const p50 = percentile(r.latencies, 50);
    const p95 = percentile(r.latencies, 95);
    const p99 = percentile(r.latencies, 99);
    const max = Math.max(...r.latencies);
    const total = r.success + r.failed;
    const errorRate = total > 0 ? ((r.failed / total) * 100).toFixed(2) : '0.00';

    console.log(`${r.rps}\t${avg.toFixed(1)}\t${p50.toFixed(1)}\t${p95.toFixed(1)}\t${p99.toFixed(1)}\t${max.toFixed(1)}\t${r.success}\t${r.failed}\t${errorRate}%`);

    // تحديد نقطة التدهور (زمن P95 > 2000ms أو أخطاء > 5%)
    if (!breakingPoint && (p95 > 2000 || parseFloat(errorRate) > 5)) {
      breakingPoint = r.rps;
    }
  }

  console.log(`\n⚠️ نقطة التدهور المقترحة: ${breakingPoint ? breakingPoint + ' مستخدم/ثانية' : 'لم يتجاوز الحدود'}`);
  console.log(`✅ السعة الآمنة المقترحة: ${breakingPoint ? breakingPoint - 10 : 'أكثر من ' + CONFIG.maxRps} مستخدم/ثانية`);
}

runCapacityTest().catch(console.error);
