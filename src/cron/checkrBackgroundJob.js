// /cron/checkrBackgroundJob.js

const mongoose = require('mongoose');
// const cron = require('node-cron');
const User = require('../models/User'); // adjust path
const { getCandidateReportStatus } = require('../services/checkrService');
require('dotenv').config();

// ✅ Fetch latest report status from Checkr
async function getLatestReportStatus(candidateId) {
  const candidate = await getCandidateReportStatus(candidateId);
  console.log(candidate,"candidatecandidatecandidate")
  if (!candidate.report_ids || candidate.report_ids.length === 0) {
    return { status: 'no-report', reportId: null };
  }

  const latestReportId = candidate.report_ids[0];
  const { data: report } = await checkr.get(`/reports/${latestReportId}`);
  return { status: report.status, reportId: latestReportId };
}

// ✅ Main job function
async function processBackgroundChecks() {
  console.log('🚀 Running Checkr Background Check Job...');

  // 1️⃣ Find all drivers with backgroundCheck = false
  const drivers = await User.find({
    role: 'driver',
    'driver.backgroundCheck': false,
    'driver.checkr.candidateId': { $exists: true, $ne: null }
  });

  console.log(`🧍 Found ${drivers.length} drivers to verify.`);

  for (const driver of drivers) {
    try {
      const candidateId = driver.driver.checkr.candidateId;
      const { status, reportId } = await getLatestReportStatus(candidateId);

      console.log(`📡 Candidate ${candidateId} → status: ${status}`);

      if (status === 'clear') {
        // ✅ Passed background check → update DB
        driver.driver.backgroundCheck = true;
        driver.driver.checkr.reportId = reportId;
        driver.driver.checkr.status = 'clear';
        driver.driver.checkr.lastEvent = 'background_clear';
        driver.driver.checkr.lastEventAt = new Date();
        await driver.save();

        console.log(`✅ Driver ${driver._id} background check marked as passed.`);
      } else if (status === 'no-report') {
        console.log(`⏳ Candidate ${candidateId} has no report yet.`);
      } else {
        console.log(`⚠️ Candidate ${candidateId} background check status: ${status}`);
      }

    } catch (error) {
      console.error(`❌ Error processing driver ${driver._id}:`, error.response?.data || error.message);
    }
  }

  console.log('✅ Background Check Job Completed.');
}



// Optional: run immediately if this file is executed manually
if (require.main === module) {
  (async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    await processBackgroundChecks();
    await mongoose.disconnect();
    process.exit();
  })();
}
