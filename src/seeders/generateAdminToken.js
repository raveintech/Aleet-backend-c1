/**
 * seeders/generateAdminToken.js
 * ---------------------------------------------------------------------------
 * Generates a long-lived JWT token for an existing admin user.
 *
 * Run:
 *   node src/seeders/generateAdminToken.js
 *   node src/seeders/generateAdminToken.js admin@swifthaven.com   (specific admin)
 * ---------------------------------------------------------------------------
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.local') });

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

(async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        const emailArg = process.argv[2];
        const query = emailArg
            ? { email: emailArg, role: 'admin' }
            : { role: 'admin' };

        const admin = await User.findOne(query).select('_id name email role');

        if (!admin) {
            console.error('\n❌ No admin found in the database.');
            console.error('   Run first: node src/seeders/adminSeeder.js seed\n');
            process.exit(1);
        }

        const secret = process.env.JWT_SECRET;
        if (!secret || secret === 'your_jwt_secret_here') {
            console.error('\n⚠️  JWT_SECRET is not set properly in .env.local');
            console.error('   Update JWT_SECRET to a strong random string before production use.\n');
        }

        const token = jwt.sign(
            { id: admin._id, role: admin.role },
            secret,
            { expiresIn: '30d' }
        );

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`👤  Admin : ${admin.name}`);
        console.log(`📧  Email : ${admin.email}`);
        console.log(`🆔  ID    : ${admin._id}`);
        console.log(`⏳  Expires: 30 days`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log('🔑 Token:\n');
        console.log(token);
        console.log('\n📋 Authorization header:\n');
        console.log(`Authorization: Bearer ${token}`);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
})();
