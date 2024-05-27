const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
var bodyParser = require('body-parser')
var cron = require('node-cron');
var axios = require("axios")

require("dotenv").config()

const shopifyHeaders = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN
};

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
    order_id: String,
    order_number: String,
    tracking_url: String,
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
            sendTelegramMessage("נקלטה הזמנה חדשה: " + JSON.stringify(orderData))
            const shippingTitle = orderData.shipping_lines.title ?? orderData.shipping_lines[0].title;
            const shippingMethod = shippingTitle.includes("שליח עד הבית") ? 1 : 2;
            const trackingUrl = orderData.fulfillments[0] ? orderData.fulfillments[0].tracking_url : null;

            const newOrder = new Order({
                first_name: orderData.billing_address.first_name,
                last_name: orderData.billing_address.last_name,
                phone: orderData.billing_address.phone,
                items: orderData.line_items.map(item => item.name),
                shipping_code: shippingMethod,
                order_id: orderData.id,
                order_number: orderData.order_number,
                tracking_url: trackingUrl,
            });

            const savedOrder = await newOrder.save();
            console.log(savedOrder)
            res.status(201).send({ message: 'Order saved successfully'});
    } catch (error) {
        console.log(error)
        res.status(500).send({ error: 'Failed to save order' });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

cron.schedule('* * * * *', () => {
    console.log('running a task every minute');
    checkOrdersUpdate()
  });


const sendTelegramMessage = (msg) => {
    const chatId = '-4258353216';
    const url = `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`;

    const params = {
        chat_id: chatId,
        text: msg,
    };
    
    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
    })
    .then(response => console.log("Telegram Alert Sent"))
    .catch(error => console.error('Error:', error));
}

const checkOrdersUpdate = async () => {
    try {
        const orders = await Order.find();
        orders.forEach(order => {
          if (order.shipping_code === 1) {
            checkDeliveryOrder(order)
          } else {
            checkPickupOrder(order)
          }
        });
      } catch (error) {
        console.error('Error:', error);
    }
}

const checkPickupOrder = async (order) => {
    const metafieldsResponse = await fetch(`https://weshoes2.myshopify.com/admin/api/2024-01/orders/${order.order_id}/metafields.json`, { shopifyHeaders });
    const metafieldsData = await metafieldsResponse.json();
    const statusMetafield = metafieldsData.metafields.find(m => m.key === "operational_status");
    if(statusMetafield.value.includes("הגיע ללקוח") || tatusMetafield.value.includes("נאספה")) {
        sendTelegramMessage("הזמנה נאספה: " + JSON.stringify(order))
    }
}

const checkDeliveryOrder = async (order) => {
    if(order.tracking_url) {
        const {tracking_url} = order.fulfillments
        fetch(tracking_url)
        .then(response => response.text())
        .then(html => {
            const containsString = html.includes("סגור") || html.includes("אישור להניח ליד הדלת");
            if(containsString) sendTelegramMessage("משלוח נמסר: " + JSON.stringify(order))
        })
        .catch(error => console.error('Error:', error));
    }
    else {
        const orderResponse = await fetch(`https://weshoes2.myshopify.com/admin/api/2024-01/orders/${order.order_id}.json`, { shopifyHeaders });
        const orderData = await orderResponse.json();
        if(orderData && orderData.fulfillments && orderData.fulfillments[0] && orderData.fulfillments[0].tracking_url) {
            await Order.findByIdAndUpdate(order.id, {tracking_url: orderData.fulfillments[0].tracking_url})
            checkDeliveryOrder(order)
        }
    }
}

