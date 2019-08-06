const express = require('express');
const router = express.Router();
const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB({apiVersion: '2012-08-10', region: 'us-east-1'});
const { generatePOString, sendMail } = require('../tools/email');
const config = require('../config/config');

router.get('/approve', (req, res) => {
    
    const email = req.query.email;
    const token = req.query.token;

    console.log('query parameters');
    console.log(email);
    console.log(token);
    
    if (!email || !token) {
        
        // Token or Email is missing, sending error response
        res.send('Error. Missing email or token.');
    
    } else {
        
        // Successfully received token and email
        var params = {
            Key: {
                email: {
                    S: email
                },
                token: {
                    S: token
                }
            },
            TableName: 'invoices'
        };
        
        dynamodb.getItem(params, (err, data) => {
            if(err) {
                
                console.log(err, err.stack);
                
                res.send('Error. User not found.');
                
            }
            else {
                
                if(data.Item) {
                    
                    // User has been found and the token is in the database
                    if(data.Item.approved.BOOL == true) {
                        
                        console.log('already approved');
                        
                        res.send('Invoice already approved.');
                    
                    } else {
                    
                        console.log('Approving invoice.');
                        
                        const Item = data.Item;
                        
                        // 2592000000 represents 30 days: 1000ms/s * 60s/min * 60min/hr * 24hr/day * 30days/month
                        console.log(Date.now() - parseInt(data.Item.timestamp.N));
                        if(Date.now() - parseInt(data.Item.timestamp.N) <= 2592000000) {
                            // Updating invoice to be marked as approved
                            data.Item.approved.BOOL = true;
                            
                            params = {
                                Item: data.Item,
                                TableName: 'invoices',
                                ReturnConsumedCapacity: 'TOTAL'
                            };
                            
                            dynamodb.putItem(params, (err, data) => {
                                if(err) {
                                    
                                    console.log(err, err.stack);
                                    res.send('Something went wrong.');
                                    
                                } else {
                                    
                                    // Send emails to AP
                                    const content = generatePOString(Item);
                                    
                                    const params = {
                                        to: config.ap_email,
                                        subject: '1099 Invoice for Processing',
                                        text: content,
                                        html: content
                                    };
                                    
                                    sendMail(params, (err, info) => {
                                        if(err) {
                                            
                                            console.log(err, err.stack);
                                        
                                        } else {
                                            
                                            res.send('Invoice approved!');
                                            
                                            console.log("Message sent: %s", info.messageId);
                                            // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>
                                            
                                        }
                                    });
                                    
                                }
                            });
                        } else {
                            res.send('Invoice has expired. Please contact ' + config.admin_email + ' to process the invoice.');
                        }
                    }
                    
                } else {
                    
                    res.send('Error. User not found.');
                }
            }
        });
        
    }
    
});

module.exports = router;
                    