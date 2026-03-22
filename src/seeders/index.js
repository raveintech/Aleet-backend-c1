const mongoose = require('mongoose');
const { seedAdmins, clearAdmins } = require('./adminSeeder');
const VehicleType = require('../models/Vehicle');
const User = require('../models/User');
require('dotenv').config();

// Sample vehicle types data
const sampleVehicleTypes = [
  {
    name: 'Luxury Sedan',
    description: 'Premium luxury sedan with leather interior and advanced amenities',
    hourlyPrice: 150
  },
  {
    name: 'SUV',
    description: 'Spacious SUV perfect for groups and families',
    hourlyPrice: 180
  },
  {
    name: 'Limousine',
    description: 'Classic limousine for special occasions and VIP transport',
    hourlyPrice: 250
  },
  {
    name: 'Van',
    description: 'Comfortable van for larger groups and airport transfers',
    hourlyPrice: 120
  }
];

// Sample test users (non-admin)
const sampleUsers = [
  {
    name: 'John Driver',
    email: 'driver@swifthaven.com',
    phone: '+1234567893',
    password: 'driver123456',
    role: 'driver',
    driver: {
      tier: 'Pro',
      backgroundCheck: true,
      vehicleTypes: [], // Will be populated after vehicle types are created
      ssn: '111-22-3333',
      driverRating: 4.8,
      active: true
    }
  },
  {
    name: 'Jane Customer',
    email: 'customer@swifthaven.com',
    phone: '+1234567894',
    password: 'customer123456',
    role: 'customer',
    subscriptionStatus: 'subscriber',
    preferences: 'premium'
  }
];

// Connect to MongoDB
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Seed vehicle types
const seedVehicleTypes = async () => {
  try {
    console.log('🚗 Starting vehicle types seeding...');

    const createdTypes = [];
    for (const vehicleData of sampleVehicleTypes) {
      const existingType = await VehicleType.findOne({ name: vehicleData.name });
      if (existingType) {
        console.log(`⚠️  Vehicle type "${vehicleData.name}" already exists. Skipping...`);
        continue;
      }

      const vehicleType = new VehicleType(vehicleData);
      await vehicleType.save();
      createdTypes.push(vehicleType);
      console.log(`✅ Created vehicle type: ${vehicleType.name} ($${vehicleType.hourlyPrice}/hour)`);
    }

    if (createdTypes.length > 0) {
      console.log(`\n🎉 Successfully created ${createdTypes.length} vehicle type(s)!`);
    } else {
      console.log('ℹ️  No new vehicle types were created.');
    }

    return createdTypes;
  } catch (error) {
    console.error('❌ Error seeding vehicle types:', error.message);
    return [];
  }
};

// Seed sample users
const seedSampleUsers = async (vehicleTypes) => {
  try {
    console.log('👥 Starting sample users seeding...');

    const createdUsers = [];
    for (const userData of sampleUsers) {
      const existingUser = await User.findOne({ email: userData.email });
      if (existingUser) {
        console.log(`⚠️  User with email ${userData.email} already exists. Skipping...`);
        continue;
      }

      // For drivers, assign vehicle types if available
      if (userData.role === 'driver' && vehicleTypes.length > 0) {
        userData.driver.vehicleTypes = vehicleTypes.map(vt => vt._id);
      }

      const user = new User(userData);
      await user.save();
      createdUsers.push(user);
      console.log(`✅ Created user: ${user.name} (${user.email}) - Role: ${user.role}`);
    }

    if (createdUsers.length > 0) {
      console.log(`\n🎉 Successfully created ${createdUsers.length} sample user(s)!`);
      console.log('\n📋 Sample User Credentials:');
      createdUsers.forEach(user => {
        console.log(`\n👤 ${user.name}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Password: ${userData.password}`);
        console.log(`   Role: ${user.role}`);
      });
    } else {
      console.log('ℹ️  No new sample users were created.');
    }

    return createdUsers;
  } catch (error) {
    console.error('❌ Error seeding sample users:', error.message);
    return [];
  }
};

// Clear all seeded data
const clearAllData = async () => {
  try {
    console.log('🗑️  Clearing all seeded data...');

    const adminResult = await User.deleteMany({ role: 'admin' });
    const driverResult = await User.deleteMany({ role: 'driver' });
    const customerResult = await User.deleteMany({ role: 'customer' });
    const vehicleTypeResult = await VehicleType.deleteMany({});

    console.log(`✅ Deleted ${adminResult.deletedCount} admin(s)`);
    console.log(`✅ Deleted ${driverResult.deletedCount} driver(s)`);
    console.log(`✅ Deleted ${customerResult.deletedCount} customer(s)`);
    console.log(`✅ Deleted ${vehicleTypeResult.deletedCount} vehicle type(s)`);

  } catch (error) {
    console.error('❌ Error clearing data:', error.message);
  }
};

// Seed everything
const seedAll = async () => {
  try {
    console.log('🌱 Starting complete seeding process...\n');

    // Seed vehicle types first
    const vehicleTypes = await seedVehicleTypes();
    console.log('');

    // Seed admins
    await seedAdmins();
    console.log('');

    // Seed sample users
    await seedSampleUsers(vehicleTypes);
    console.log('');

    console.log('🎉 Complete seeding process finished successfully!');

  } catch (error) {
    console.error('❌ Error in complete seeding:', error.message);
  }
};

// Main function
const main = async () => {
  const command = process.argv[2];

  try {
    await connectDB();

    switch (command) {
      case 'seed':
        await seedAll();
        break;
      case 'seed:admin':
        await seedAdmins();
        break;
      case 'seed:vehicles':
        await seedVehicleTypes();
        break;
      case 'seed:users':
        const vehicleTypes = await VehicleType.find();
        await seedSampleUsers(vehicleTypes);
        break;
      case 'clear':
        await clearAllData();
        break;
      case 'clear:admin':
        await clearAdmins();
        break;
      case 'reset':
        await clearAllData();
        await seedAll();
        break;
      default:
        console.log('📖 Swift Haven Backend Seeder');
        console.log('==============================\n');
        console.log('Available commands:');
        console.log('  npm run seed              - Seed all data (admins, vehicles, users)');
        console.log('  npm run seed:admin        - Seed admin users only');
        console.log('  npm run seed:vehicles     - Seed vehicle types only');
        console.log('  npm run seed:users        - Seed sample users only');
        console.log('  npm run seed:clear        - Clear all seeded data');
        console.log('  npm run seed:clear:admin  - Clear admin users only');
        console.log('  npm run seed:reset        - Clear and reseed all data');
        console.log('\n🔧 Or run directly:');
        console.log('  node src/seeders/index.js [seed|seed:admin|seed:vehicles|seed:users|clear|clear:admin|reset]');
    }

    await mongoose.connection.close();
    console.log('\n🔌 MongoDB connection closed');
    process.exit(0);

  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  }
};

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  seedAll,
  seedAdmins,
  seedVehicleTypes,
  seedSampleUsers,
  clearAllData,
  clearAdmins,
  connectDB
};
