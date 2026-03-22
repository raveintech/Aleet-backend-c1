const mongoose = require('mongoose');

const addOnSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },   // e.g. VIP Comforts
  description: { type: String },
  type: { type: String, enum: ['free', 'paid'], required: true }, // free or paid
  price: { type: Number, default: 0 }, // only required if type = paid
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Admin who created
}, { timestamps: true });

module.exports = mongoose.model('AddOn', addOnSchema);
