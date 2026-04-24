const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = getFirestore();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    // Get last 90 days of logs
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const snap = await db
      .collection('users').doc(userId)
      .collection('logs')
      .where('createdAt', '>', ninetyDaysAgo)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const triggerLogs = logs.filter(l => l.type === 'trigger');
    const crisisLogs = logs.filter(l => l.type === 'crisis');
    const milestoneLogs = logs.filter(l => l.type === 'milestone');

    if (triggerLogs.length + crisisLogs.length < 3) {
      return res.status(200).json({
        hasPatterns: false,
        message: 'Keep logging — patterns will appear once you have more entries.',
        logsNeeded: 3 - (triggerLogs.length + crisisLogs.length)
      });
    }

    // ── Statistical analysis ──
    const stats = analysePatterns(triggerLogs, crisisLogs, milestoneLogs);

    // ── AI narrative ──
    const narrative = await generateNarrative(stats, triggerLogs.length, crisisLogs.length);

    return res.status(200).json({
      hasPatterns: true,
      stats,
      narrative,
      logCount: logs.length,
      analysedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Pattern detection error:', error);
    return res.status(500).json({ error: 'Analysis failed', details: error.message });
  }
};

function analysePatterns(triggerLogs, crisisLogs, milestoneLogs) {
  const total = triggerLogs.length;
  if (total === 0) return {};

  // Count occurrences
  const timeCount = {}, foodCount = {}, sleepCount = {}, triggerCount = {}, whatCount = {};

  triggerLogs.forEach(log => {
    const d = log.data || {};
    if (d.time)    timeCount[d.time]    = (timeCount[d.time]    || 0) + 1;
    if (d.food)    foodCount[d.food]    = (foodCount[d.food]    || 0) + 1;
    if (d.sleep)   sleepCount[d.sleep]  = (sleepCount[d.sleep]  || 0) + 1;
    if (d.what)    whatCount[d.what]    = (whatCount[d.what]    || 0) + 1;
    if (d.trigger) {
      d.trigger.split(',').forEach(t => {
        const clean = t.trim();
        triggerCount[clean] = (triggerCount[clean] || 0) + 1;
      });
    }
  });

  // Calculate percentages and find dominant patterns
  function topEntry(obj) {
    const entries = Object.entries(obj);
    if (!entries.length) return null;
    entries.sort((a, b) => b[1] - a[1]);
    return { value: entries[0][0], count: entries[0][1], pct: Math.round((entries[0][1] / total) * 100) };
  }

  // Week over week trend
  const now = Date.now();
  const thisWeek = triggerLogs.filter(l => l.createdAt > now - 7*24*60*60*1000).length;
  const lastWeek = triggerLogs.filter(l => l.createdAt > now - 14*24*60*60*1000 && l.createdAt <= now - 7*24*60*60*1000).length;
  const trend = thisWeek < lastWeek ? 'improving' : thisWeek > lastWeek ? 'worsening' : 'stable';

  // Most affected time
  const topTime    = topEntry(timeCount);
  const topFood    = topEntry(foodCount);
  const topSleep   = topEntry(sleepCount);
  const topTrigger = topEntry(triggerCount);
  const topWhat    = topEntry(whatCount);

  // Poor sleep correlation
  const poorSleepLogs = triggerLogs.filter(l => {
    const s = (l.data?.sleep || '').toLowerCase();
    return s.includes('poor') || s.includes('broken') || s.includes('under');
  });
  const poorSleepPct = total > 0 ? Math.round((poorSleepLogs.length / total) * 100) : 0;

  // Hunger/food gap correlation
  const hungerLogs = triggerLogs.filter(l => {
    const f = (l.data?.food || '').toLowerCase();
    const t = (l.data?.trigger || '').toLowerCase();
    return f.includes('3+') || f.includes('skipped') || t.includes('hunger');
  });
  const hungerPct = total > 0 ? Math.round((hungerLogs.length / total) * 100) : 0;

  return {
    totalEpisodes: total,
    totalCrisis: crisisLogs.length,
    totalMilestones: milestoneLogs.length,
    trend,
    thisWeek,
    lastWeek,
    topTime,
    topFood,
    topSleep,
    topTrigger,
    topWhat,
    poorSleepPct,
    hungerPct,
    timeBreakdown: timeCount,
    triggerBreakdown: triggerCount,
  };
}

async function generateNarrative(stats, triggerCount, crisisCount) {
  const prompt = `You are AutiMa, an AI assistant for autism parents. 
Analyse this data about a child's behavioral episodes and write 2-3 SHORT, specific pattern insights.

Data:
- Total logged episodes: ${triggerCount}
- Crisis sessions: ${crisisCount}
- Most common time of day: ${stats.topTime?.value || 'varies'} (${stats.topTime?.pct || 0}% of episodes)
- Most common trigger: ${stats.topTrigger?.value || 'unknown'} (${stats.topTrigger?.pct || 0}% of episodes)
- Episodes preceded by poor/broken sleep: ${stats.poorSleepPct}%
- Episodes with 3+ hour food gap or skipped meal: ${stats.hungerPct}%
- Most common behavior: ${stats.topWhat?.value || 'varies'}
- This week vs last week: ${stats.trend}
- This week episodes: ${stats.thisWeek}, Last week: ${stats.lastWeek}

Rules:
- Write exactly 2-3 insight bullets
- Each bullet starts with an emoji then a bold pattern name, then a colon, then the insight
- Be specific with numbers and percentages
- Focus on actionable patterns only
- Keep each bullet under 25 words
- Format: "🕐 **Peak Time**: [insight]"
- Do not include section headers or intro text
- Only output the bullet points, nothing else`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
      temperature: 0.5
    })
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}
