const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
var bodyParser = require('body-parser')
var cron = require('node-cron');
var parsePhoneNumber = require('libphonenumber-js')

require("dotenv").config()

const shopifyHeaders = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN
};

var sendPulseHeaders = {
    "Content-Type": "application/json",
    "Authorization": ""
}

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
    delivery_hint_sent: Boolean,
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
            const trackingUrl = orderData.fulfillments[0] ? orderData.fulfillments[0].tracking_url : null;

            const newOrder = new Order({
                first_name: orderData.billing_address.first_name,
                last_name: orderData.billing_address.last_name,
                phone: orderData.billing_address.phone,
                items: orderData.line_items.map(item => item.name),
                shipping_code: shippingMethod,
                order_id: orderData.id,
                order_number: orderData.name,
                tracking_url: trackingUrl,
                delivery_hint_sent: false
            });

            const savedOrder = await newOrder.save();
            console.log("New Order Detected: ", savedOrder)
            res.status(201).send({ message: 'Order saved successfully'});
    } catch (error) {
        console.log(error)
        res.status(500).send({ error: 'Failed to save order' });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    getSendPulseToken()
});

cron.schedule('0,5 * * * *', () => {
    console.log('running a task every minute');
    getSendPulseToken()
    checkOrdersUpdate()
  });


const getSendPulseToken = async () => {
    const res = await fetch('https://api.sendpulse.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.SENDPULSE_ID,
      client_secret: process.env.SENDPULSE_SECRET
    })
  });
  const jsonRes = await res.json()
  if(jsonRes.access_token) {
    sendPulseHeaders.Authorization = `${jsonRes.token_type} ${jsonRes.access_token}`
  }
}

const sendWhatsAppStatus = async (order) => {
    let parsedNumber = parsePhoneNumber(order.phone, "IL")
    if(!parsedNumber) return;
    const metafieldsResponse = await fetch(`https://weshoes2.myshopify.com/admin/api/2023-10/orders/${order.order_id}/metafields.json`, { headers: shopifyHeaders });
    const metafieldsData = await metafieldsResponse.json();
    let branchMetafield = metafieldsData.metafields.find(m => m.key === "supply_branch_name");
    if(!branchMetafield) branchMetafield = ""
    parsedNumber = parsedNumber.number.replace("+", "")
    const res = await fetch('https://api.sendpulse.com/whatsapp/contacts', {
        method: 'POST',
        headers: sendPulseHeaders,
        body: JSON.stringify({
            "phone": parsedNumber,
            "name": `${order.first_name} ${order.last_name}`,
            "bot_id": "6653512f9c10ef96300b5cea"
        })
    });
    const jsonRes = await res.json()
    if(jsonRes.success) console.log(`WhatsApp contact created successfuly: ${order.order_number}`)
    else console.log("Error while creating WhatsApp contact: ", jsonRes)

    const contactId = jsonRes.id

    const pickupTemplate = {
        "name": "status_notify_pickup_2",
        "language": {
          "code": "he"
        },
        "components": [
          {
            "type": "body",
            "parameters": [
              {
                "type": "text",
                "text": order.first_name
              },
              {
                "type": "text",
                "text": branchMetafield.value || "WeShoes"
              },
              {
                "type": "text",
                "text": `${order.order_number}`
              }
            ]
          }
        ]
      }
      const deliveryTemplate = {
        "name": "status_notify_delivery_3",
        "language": {
          "code": "he"
        },
        "components": [
          {
            "type": "body",
            "parameters": [
              {
                "type": "text",
                "text": order.first_name
              },
              {
                "type": "text",
                "text": `${order.order_number}`
              },
              {
                "type": "text",
                "text": order.tracking_url
              }
            ]
          }
        ]
      }

    const msgRes = await fetch('https://api.sendpulse.com/whatsapp/contacts/sendTemplate', {
        method: 'POST',
        headers: sendPulseHeaders,
        body: JSON.stringify({
            "contact_id": contactId,
            "template": order.shipping_code == 1 ? deliveryTemplate : pickupTemplate
          })
    });
    const jsonMsg = await msgRes.json()
    if(jsonMsg.success) console.log(`WhatsApp Sent Successfuly: ${order.order_number}`)
    else console.log("Error while sending WhatApp message: ", jsonMsg)
}

const sendTelegramMessage = (msg) => {
    const chatId = '-1002209999103';
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
    .then(response => console.log("Telegram signal sent"))
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
    const metafieldsResponse = await fetch(`https://weshoes2.myshopify.com/admin/api/2023-10/orders/${order.order_id}/metafields.json`, { headers: shopifyHeaders });
    const metafieldsData = await metafieldsResponse.json();
    const statusMetafield = metafieldsData.metafields.find(m => m.key === "operational_status");
    if(statusMetafield.value.includes("הגיע ללקוח") || statusMetafield.value.includes("נאספה")) {
        sendTelegramMessage("הזמנה נאספה: \n" + beautifyOrder(order))
        Order.deleteOne({"_id": order._id})
        console.log("Pickup order deleted: ", order.order_number)
    }
    else if(statusMetafield.value.includes("הגיע לסניף")) {
        sendWhatsAppStatus(order)
        sendTelegramMessage("הזמנה הגיעה לסניף: \n" + beautifyOrder(order))
    }
}

const checkDeliveryOrder = async (order) => {
    if(order.tracking_url) {
        const {tracking_url} = order
        fetch(tracking_url)
        .then(response => response.text())
        .then(html => {
            if(html.includes("סגור") || html.includes("אישור להניח ליד הדלת")) {
                sendTelegramMessage("משלוח נמסר: \n" + beautifyOrder(order))
                Order.deleteOne({"_id": order._id})
                console.log("Delivery order deleted: ", order.order_number)
            }
            else if(html.includes("כניסה למחסן מיון") && !order.delivery_hint_sent) {
                Order.findByIdAndUpdate(order._id, {delivery_hint_sent: true})
                sendWhatsAppStatus(order)
            }
        })
        .catch(error => console.error('Error:', error));
    }
    else {
        console.log("we are here")
        const orderResponse = await fetch(`https://weshoes2.myshopify.com/admin/api/2023-10/orders/${order.order_id}.json`, { headers: shopifyHeaders });
        const orderData = await orderResponse.json();
        if(orderData && orderData.order.fulfillments && orderData.order.fulfillments[0] && orderData.order.fulfillments[0].tracking_url) {
            console.log("if passed")
            const updateRes = await Order.findByIdAndUpdate(order._id, {tracking_url: orderData.order.fulfillments[0].tracking_url})
            const newOrderObj = await Order.findById(updateRes._id)
            checkDeliveryOrder(newOrderObj)
        }
    }
}


const beautifyOrder = (order) => {
    let parsedNumber = parsePhoneNumber(order.phone, "IL")
    if(!parsedNumber) parsedNumber = order.phone;
    else parsedNumber = parsedNumber.number.replace("+", "")
    var justifiedItems = ""
    order.items.forEach(oi => {justifiedItems = justifiedItems + "\n• " + oi})
    return `
    שם מלא: ${order.first_name} ${order.last_name}
    מספר טלפון: ${parsedNumber}
    שיטת משלוח: ${order.shipping_code == 1 ? "משלוח עד הבית" : "איסוף מהסניף"}
    מוצרים שהוזמנו: ${justifiedItems}
    קישור למעקב: ${order.tracking_url ?? "לא הוזן"}

    תאריך הזמנה: ${order.date}
    מספר הזמנה: ${order.order_number}
    מזהה הזמנה: ${order.order_id}
    `
}
