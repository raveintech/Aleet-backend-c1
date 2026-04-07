const AddOn = require('../models/AddOn');
const { sendSuccess, sendError, sendValidationError, sendNotFound, sendConflict } = require('../utils/responseHelper');

// Add a new AddOn (Admin only)
const addAddOn = async (req, res) => {
  try {
    const { name, description, type, price } = req.body;

    if (!name || !description || !type) {
      return sendValidationError(res, 'Name, description, and type are required');
    }

    if (type === 'paid' && (!price || price <= 0)) {
      return sendValidationError(res, 'Price is required for paid add-ons');
    }

    // check duplicate
    const existing = await AddOn.findOne({ name });
    if (existing) {
      return sendConflict(res, 'Add-on already exists');
    }

    const newAddOn = new AddOn({
      name,
      description,
      type,
      price: type === 'paid' ? price : 0,
      createdBy: req.user.id
    });

    await newAddOn.save();
    return sendSuccess(res, 201, 'Add-on added successfully', newAddOn);
  } catch (error) {
    console.error('Add AddOn Error:', error);
    return sendError(res, 500, error.message || 'Failed to add add-on');
  }
};

// Get all add-ons grouped by type (customer will see these when booking)
const getAllAddOns = async (req, res) => {
  try {
    const addOns = await AddOn.find().sort({ createdAt: 1 });

    const free = addOns.filter(a => a.type === 'free');
    const paid = addOns.filter(a => a.type === 'paid');

    return sendSuccess(res, 200, 'Add-ons retrieved successfully', { free, paid });
  } catch (error) {
    console.error('Get All AddOns Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve add-ons');
  }
};

// Update AddOn (Admin only)
const updateAddOn = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, type, price } = req.body;

    if (!id) {
      return sendValidationError(res, 'Add-on ID is required');
    }

    const addOn = await AddOn.findById(id);
    if (!addOn) {
      return sendNotFound(res, 'Add-on not found');
    }

    if (name) addOn.name = name;
    if (description) addOn.description = description;
    if (type) {
      addOn.type = type;
      addOn.price = type === 'paid' ? price : 0;
    } else if (price && addOn.type === 'paid') {
      addOn.price = price;
    }

    await addOn.save();
    return sendSuccess(res, 200, 'Add-on updated successfully', addOn);
  } catch (error) {
    console.error('Update AddOn Error:', error);
    return sendError(res, 500, error.message || 'Failed to update add-on');
  }
};

// Delete AddOn (Admin only)
const deleteAddOn = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return sendValidationError(res, 'Add-on ID is required');
    }

    const addOn = await AddOn.findById(id);
    if (!addOn) {
      return sendNotFound(res, 'Add-on not found');
    }

    await addOn.deleteOne();
    return sendSuccess(res, 200, 'Add-on deleted successfully');
  } catch (error) {
    console.error('Delete AddOn Error:', error);
    return sendError(res, 500, error.message || 'Failed to delete add-on');
  }
};

module.exports = { addAddOn, getAllAddOns, updateAddOn, deleteAddOn };

