"use strict";
const nodemailer = require("nodemailer");
const config = require('../config/config');
const AWS = require('aws-sdk');
const ses = new AWS.SES({
  apiVersion: '2010-12-01',
  region: 'us-east-1'
});

const transporter = config.transport
  
/**
 * Generates the bill to section of an invoice, containing company name, department, address, and email
 */
const generateBillToString = () => {
  
  var ret = '<div class="billTo">';
  
  for(var i = 0; i < config.bill_to.length; i++) {
    ret += config.bill_to[i] + '<br/>';
  }
  
  ret += '</div>';
  
  return ret;
};

/**
 * Generates the remit to section of an invoice, containing name, address, phone, and email
 */
const generateRemitToString = (user, afterDynamo) => {
  var ret = '<div class="remitTo">';
  
  if(afterDynamo) {
    ret += user.name.S + '<br/>';
    
    ret += user.address.S + '<br/>';
    
    if(user.address_second && user.address_second.S) {
      ret += user.address_second.S + '<br/>';
    }
    
    ret += user.city.S + ', ' + user.state.S + ', ' + user.zip.S + '<br/>';
    
    ret += user.phone.S + '<br/>';
    
    ret += user.email.S + '<br/>';
  }
  else {
    ret += user.name + '<br/>';
    
    ret += user.address + '<br/>';
    
    if(user.address_second && user.address_second !== '') {
      ret += user.address_second + '<br/>';
    }
    
    ret += user.city + ', ' + user.state + ', ' + user.zip + '<br/>';
    
    ret += user.phone + '<br/>';
    
    ret += user.email + '<br/>';
  }
  
  ret += '</div>'

  return ret;
};
  
/**
 * params: {
 *  from,
 *  to,
 *  subject,
 *  text,
 *  html
 * }
 * 
 * cb = function(err, nodemailer_info)
 */
const sendMail = (params, cb) => {
  // const transporter = nodemailer.createTransport({
  //   // service: 'Gmail',
  //   host: 'smtp.gmail.com',
  //   secure: true,
  //   pool: true,
  //   auth: {
  //     user: config.email.user,
  //     pass: config.email.pass
  //   }
  // });
  
  params.from = config.email.user;
  
  if(config.use_AWS_SES) {
    const sesParams = {
      Destination: {
        ToAddresses: [params.to]
      },
      Message: {
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: params.html
          },
          Text: {
            Charset: 'UTF-8',
            Data: params.html
          }
        },
        Subject: {
          Charset: 'UTF-8',
          Data: params.subject
        }
      },
      Source: params.from
    };
    
    ses.sendEmail(sesParams, cb);
  } else {
    transporter.sendMail(params, (err, info) => {
      cb(err, info);
    });    
  }
};

// Same as sendMail, but paramsList is a list of params
const batchSendMail = (paramsList, cb) => {
  // const transporter = nodemailer.createTransport({
  //   // service: 'Gmail',
  //   host: 'smtp.gmail.com',
  //   secure: true,
  //   pool: true,
  //   auth: {
  //     user: config.email.user,
  //     pass: config.email.pass
  //   }
  // });

  // console.log(JSON.stringify(paramsList, null, 2));
  
  for(var i = 0; i < paramsList.length; i++) {
    
    paramsList[i].from = config.email.user;
    
    if(config.use_AWS_SES) {
      sendMail(paramsList[i], (err, data) => {
        if(err) {
          console.log(err, err.stack);
        } else {
          console.log(data);
        }
      });
    } else {
      transporter.sendMail(paramsList[i], (err, info) => {
        cb(err, info);
      });
    }
  }
  
  // if(emailCount == paramsList.length)
  //   transporter.close();
};

/**
 * Given the details of a user, the html for the email to AP is generated
 */
const generatePOString = (user) => {
  // console.log(user);
  const date = new Date(parseInt(user.timestamp.N));
  const style = '<style type="text/css">\
    .table, .th, .td {\
      border: 1px solid black;\
      border-collapse: collapse;\
    }\
    .number {\
      justify-content: right;\
    }\
    .reject {\
      color: red;\
    }\
    .fr {\
      float: right;\
    }\
  </style>';
  
  // START OF INVOICE
  var invoice = '<html><head>' + style + '</head><body><div class="invoice">';
  
  const remitTo = generateRemitToString(user, true);
  
  const billTo = generateBillToString();
  
  invoice += '<table class="header">\
      <td class="fr"><b>Date:</b></td>\
      <td>' + (date.getMonth()+1) + '-' + date.getDate() + '-' + date.getFullYear() + '</td>\
    </tr>\
    <tr>\
      <td class="fr"><b>PO:</b></td>\
      <td>' + user.po.S + '</td>\
    </tr>\
    <tr>\
      <td class="fr"><b>Invoice #:</b></td>\
      <td>' + user.po.S + (Date.parse(date) / 1000) + '</td>\
    </tr>\
  </table>';
  
  invoice += '<h3>Remit To:</h3>';
  invoice += remitTo;
  
  invoice += '<h3>Bill To:</h3>';
  invoice += billTo + '<br/>';
  
  invoice += '<div class="body"><table class="table">\
  <tr class="tr">\
    <th class="th">Date</th>\
    <th class="th">Description</th>\
    <th class="th">Hours</th>\
    <th class="th">Labor Rate</th>\
    <th class="th">Mileage</th>\
    <th class="th">ODCs</th>\
    <th class="th">Labor Subtotal</th>\
    <th class="th">Mileage Subtotal($'+ config.mileage_rate +'/mi)</th>\
    <th class="th">Shift Subtotal</th>\
  </tr>';
  
  var totalMileage = 0;
  var totalPayment = 0;
  var totalODCs = 0;
  
  var totalLabor = 0;
  var totalMIE = 0;
  
  for(let j = 0; j < user.shifts.L.length; j++) {
    
    const shift = user.shifts.L[j].M;
    const shift_date = new Date(parseInt(shift.start_date.N));
    
    const duration = parseFloat(shift.duration.N);
    const pay_rate = parseFloat(shift.pay_rate.N);
    const mileage = shift.mileage.N ? parseFloat(shift.mileage.N) : 0;
    
    const ODCs = parseFloat(shift.odcs.N);
    const labor = pay_rate * duration;
    const MIE = config.mileage_rate * mileage;
    
    totalMileage += mileage;
    totalPayment += labor + MIE + ODCs;
    totalODCs += ODCs;
    totalLabor += labor;
    totalMIE += MIE;
    
    invoice += '<tr class="tr">\
      <td class="td">' + (shift_date.getMonth()+1) + '-' + shift_date.getDate() + '-' + shift_date.getFullYear() + '</td>\
      <td class="td">' + shift.subject.S + '</td>\
      <td class="td number">' + duration + '</td>\
      <td class="td number">' + pay_rate + '</td>\
      <td class="td number">' + (shift.mileage.N == null ? shift.mileage.N : 'N/A') + '</td>\
      <td class="td number">$' + ODCs + '</td>\
      <td class="td number">$' + Math.round(labor * 100)/100 + '</td>\
      <td class="td number">$' + Math.round(MIE * 100)/100 + '</td>\
      <td class="td number">$' + Math.round((labor + MIE + ODCs)*100)/100 + '</td>\
    </tr>';
  }
  
  invoice += '<tr class="tr">\
    <td colspan="5" class="td number"><b>Category Subtotals:</b></td>\
    <td class="td number">$' + Math.round(totalODCs*100)/100 + '</td>\
    <td class="td number">$' + Math.round(totalLabor*100)/100 + '</td>\
    <td class="td number">$' + Math.round(totalMIE*100)/100 + '</td>\
    <td class="td number">$' + Math.round(totalPayment*100)/100 + '</td>\
  </tr>';
  
  invoice += '<tr class="tr">\
    <td colspan="8" class="td number"><b>Invoice Total:</b></td>\
    <td class="td number"><b>$' + Math.round(totalPayment*100)/100 + '</b></td>\
  </tr>';
  
  invoice += '</div></table>';
  
  invoice += '</div></body></html>';
  // END OF INVOICE
  
  return invoice;
};

// Generates and sends invoices to all users given
// users: [user]
// user: {
//   id,
//   email,
//   name,
//   shifts: [ { subject, start_date, end_date, duration, mileage } ],
//   pay_rate,
//   po
// }
const batchSendInvoices = async (users) => {
  
  var paramsList = [];

  for(let i = 0; i < users.length; i++) {
    var user = users[i];
    
    const date = new Date();//user.timestamp);
    const style = '<style type="text/css">\
      .table, .th, .td {\
        border: 1px solid black;\
        border-collapse: collapse;\
      }\
      .number {\
        justify-content: right;\
      }\
      .btn {\
        padding: 0.5rem 1rem 0.5rem;\
        text-decoration: none;\
        border-color: blue;\
        border-radius: 3px;\
        border-style: solid;\
        border-width: 2px;\
        color: blue;\
        background-color: white;\
        margin: 10px;\
        font-weight: 900;\
        display: inline-block;\
      }\
      .fr {\
        float: right;\
      }\
    </style>';
    
    // START OF INVOICE
    var invoice = '<html><head>' + style + '</head><body><div class="invoice">';
    
    const remitTo = generateRemitToString(user, false);
  
    const billTo = generateBillToString();
    
    invoice += '<table class="header">\
        <td class="fr"><b>Date:</b></td>\
        <td>' + (date.getMonth()+1) + '-' + date.getDate() + '-' + date.getFullYear() + '</td>\
      </tr>\
      <tr>\
        <td class="fr"><b>PO:</b></td>\
        <td>' + user.po + '</td>\
      </tr>\
      <tr>\
        <td class="fr"><b>Invoice #:</b></td>\
        <td>' + user.po + (Date.parse(date) / 1000) + '</td>\
      </tr>\
    </table>';
    
    invoice += '<h3>Remit To:</h3>';
    invoice += remitTo;
    
    invoice += '<h3>Bill To:</h3>';
    invoice += billTo + '<br/>';
    
    invoice += '<div class="body"><table class="table">\
    <tr class="tr">\
      <th class="th">Date</th>\
      <th class="th">Description</th>\
      <th class="th">Hours</th>\
      <th class="th">Labor Rate</th>\
      <th class="th">Mileage</th>\
      <th class="th">ODCs</th>\
      <th class="th">Labor Subtotal</th>\
      <th class="th">Mileage Subtotal($'+ config.mileage_rate +'/mi)</th>\
      <th class="th">Shift Subtotal</th>\
    </tr>';
    
    var totalPayment = 0;
    var totalMileage = 0;
    var totalODCs = 0;
    var totalLabor = 0;
    var totalMIE = 0;
    
    for(let j = 0; j < user.shifts.length; j++) {
      
      const shift = user.shifts[j];
      const shift_date = new Date(shift.start_date);
      
      const labor = shift.pay_rate * shift.duration;
      const MIE = shift.mileage * config.mileage_rate;
      
      totalMileage += shift.mileage;
      totalPayment += labor + MIE + shift.odcs;
      totalODCs += shift.odcs;
      totalLabor += labor;
      totalMIE += MIE;

      invoice += '<tr class="tr">\
        <td class="td">' + (shift_date.getMonth()+1) + '-' + shift_date.getDate() + '-' + shift_date.getFullYear() + '</td>\
        <td class="td">' + shift.subject + '</td>\
        <td class="td number">' + shift.duration + '</td>\
        <td class="td number">$' + shift.pay_rate + '</td>\
        <td class="td number">' + (shift.mileage == null ? shift.mileage : 'N/A') + '</td>\
        <td class="td number">$' + shift.odcs + '</td>\
        <td class="td number">$' + Math.round(labor * 100)/100 + '</td>\
        <td class="td number">$' + Math.round(MIE * 100)/100 + '</td>\
        <td class="td number">$' + Math.round((labor + MIE + shift.odcs)*100)/100 + '</td>\
      </tr>';
    }
    
    invoice += '<tr class="tr">\
      <td colspan="5" class="td number"><b>Category Subtotals:</b></td>\
      <td class="td number">$' + Math.round(totalODCs*100)/100 + '</td>\
      <td class="td number">$' + Math.round(totalLabor*100)/100 + '</td>\
      <td class="td number">$' + Math.round(totalMIE*100)/100 + '</td>\
      <td class="td number">$' + Math.round(totalPayment*100)/100 + '</td>\
    </tr>';
    
    invoice += '<tr class="tr">\
      <td colspan="8" class="td number"><b>Invoice Total:</b></td>\
      <td class="td number"><b>$' + Math.round(totalPayment*100)/100 + '</b></td>\
    </tr>';
    
    invoice += '</div></table>';

    invoice += '<div class="reject">Please contact ' + config.admin_email + ' if the invoice contains an error.</div>';

    invoice += '<a class="btn" href="' + (config.endpoint + config.approval_route +'?email=' + encodeURIComponent(user.email) + '&token=' + encodeURIComponent(user.token)) + '">Approve</a>';

    invoice += '</div></body></html>';
    // END OF INVOICE
    
    paramsList.push({
      from: config.email.user,
      to: user.email,
      subject: 'GDIT 1099 Invoice',
      text: invoice,//'Error rendering HTML',
      html: invoice
    });

  }
  
  batchSendMail(paramsList, (err, info) => {
    
    if(err) {
      
      console.log(err, err.stack);
    
    } else {
          
      console.log("Message sent: %s", info.messageId);
      // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>
    
      // Preview only available when sending through an Ethereal account
      console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
      // Preview URL: https://ethereal.email/message/WaQKMgKddxQDoou...
      
    }
  });

};

module.exports = {
  batchSendInvoices,
  sendMail,
  batchSendMail,
  generatePOString
};