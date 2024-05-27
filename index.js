const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
var bodyParser = require('body-parser')
require("dotenv").config()

// Connect to MongoDB
mongoose.connect(process.env.DB_HOST, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log(err));

// Define the order schema
const orderSchema = new mongoose.Schema({
    first_name: String,
    last_name: String,
    phone: String,
    items: [String],
    shipping_code: Number,
    date: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', orderSchema);

const app = express();
app.use(express.json());
app.use(cors());
app.use(bodyParser.urlencoded({
    extended: true
  }));

app.get('/', async (req, res) => {
    res.send("Default Page")
})

// Define the /newOrder route
app.post('/newOrder', async (req, res) => {
    try {
        const orderData = req.body;

            const shippingTitle = orderData.shipping_lines.title ?? orderData.shipping_lines[0].title;
            const shippingMethod = shippingTitle.includes("שליח עד הבית") ? 1 : 2;

            const newOrder = new Order({
                first_name: orderData.billing_address.first_name,
                last_name: orderData.billing_address.last_name,
                phone: orderData.billing_address.phone,
                items: orderData.line_items.map(item => item.name),
                shipping_code: shippingMethod
            });

            const savedOrder = await newOrder.save();
            console.log(savedOrder)
            res.status(201).send({ message: 'Order saved successfully', savedOrder});
    } catch (error) {
        console.log(error)
        res.status(500).send({ error: 'Failed to save order' });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});