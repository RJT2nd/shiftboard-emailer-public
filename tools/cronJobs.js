/*
access = '5952f7c2-66b4-4fc1-b72d-43e178eac1b5'
signature = '96rVsFN5co29UhiDKJusiJR0j8triGcQzx02uVY/'

def shiftboard(methodName, params):
	#print(params)
	paramsStr = json.dumps(params)
	paramsEnc = paramsStr.encode('base64').strip().replace('\n','')

	# sign the API request
	sign = 'method' + methodName + 'params' + paramsStr
	signEnc = hmac.HMAC(signature, sign, sha1).digest().encode('base64').strip()

	url = 'https://api.shiftdata.com/?id=1&jsonrpc=2.0&access_key_id=' + access + '&method=' + methodName + '&params=' + paramsEnc + '&signature=' + signEnc
*/

const crypto = require('crypto');
const axios = require('axios');
const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB({apiVersion: '2012-08-10', region: 'us-east-1'});
const { batchSendInvoices } = require('./email');
const config = require('../config/config');

/**
 * getUrl returns the request url given a set of parameters
 * determined by the shiftboard api and a method name.
 */
const getUrl = (params, methodName) => {
	
	const accessKey = config.shiftboard.accessKey;
	const signature = config.shiftboard.signature;


	var paramsString = JSON.stringify(params, null, 2);

	var paramsEncoded = Buffer.from(paramsString).toString('base64');
	
	const request = 'method' + methodName + 'params' + paramsString;
	const signedRequest = crypto.createHmac('sha1', signature).update(request).digest('base64');
	
	const url = 'https://api.shiftdata.com/?id=1&jsonrpc=2.0&access_key_id=' + accessKey + '&method=' + methodName + '&params=' + paramsEncoded + '&signature=' + signedRequest;

	return url;
};

// Gets the date for last friday
const getEndDate = () => {
	
	const date = new Date();
	
	const currentDay = date.getDay();
	
	const currentDate = date.getDate();
	
	date.setDate(currentDate - currentDay - 2);
	
	return date;
};

// Gets all shifts and adds some info given a set of timecards
const getAllShifts = async (timecards) => {
	
	const date = getEndDate();
	
	// Dates must be in YYYY-MM-DD format; e.g. 2019-06-30 where the 0 in the month field is required
	var end_date = date.getFullYear() + '-' + ((date.getMonth()+1) < 10 ? '0' : '') + (date.getMonth()+1) + '-' + (date.getDate() < 10 ? '0' : '') + date.getDate();
	
	date.setDate(date.getDate() - 13);
	
	var start_date = date.getFullYear() + '-' + ((date.getMonth()+1) < 10 ? '0' : '') + (date.getMonth()+1) + '-' + (date.getDate() < 10 ? '0' : '') + date.getDate();
	
	console.log(start_date, end_date);
	
	var params = {
		'select': {
			'start_date': start_date,//'2018-06-01',//start_date,
			'end_date': end_date//'2018-08-01'//end_date
		},
		'page': {
			'start': 1,
			'batch': 500
		},
		extended: true
	};
	
	// console.log(params);
	
	var shifts = [];
	
	const methodName = 'shift.list';
	
	var url = getUrl(params, methodName);
	
	const handleBatch = async (res) => {
		
		if(res.data && res.data.result) {
			
			shifts = shifts.concat(res.data.result.shifts);
	
			if(res.data.result.page && res.data.result.page.next) {
				
				params.page = res.data.result.page.next;
				
				url = getUrl(params, methodName);
				
				await axios.get(url)
				.then(handleBatch)
				.catch((err) => console.log(err, err.stack));
			}
		}
	};
	
	await axios.get(url)
	.then(handleBatch)
	.catch((err) => console.log(err, err.stack));
	
	var workgroupsList = [];
	
	for(var i = 0; i < shifts.length; i++) {
		shifts[i].odcs = 0;
		
		if(shifts[i].workgroup != null) {
			workgroupsList.push(shifts[i].workgroup);
		}
	}
	
	for(var i = 0; i < timecards.length; i++) {
		
		var timecard = timecards[i];
		
		for (var j = 0; j < shifts.length; j++) {
			
			var shift = shifts[j];
			
			if(shift.odcs === null || shift.odcs === '') {
				shift.odcs = 0;
			}
			
			if (shift.id === timecard.shift) {
				
				shift.mileage = timecard.mileage;
				
				shift.odcs = timecard.custom_expense_5;
				
				if(shift.odcs === null || shift.odcs === '') {
					shift.odcs = 0;
				} else if(typeof(shift.odcs) === 'string') {
					shift.odcs = parseFloat(shift.odcs);
				}
				
			} else if (!shift.mileage) {
				
				shift.mileage = 0; // set to null if you want it to say N/A
				
			}
		}
	}
	
	// Getting team/workgroup pay rates
	params = {
		select: {
			workgroup: workgroupsList
		},
		extended: true
	};
	
	url = getUrl(params, 'workgroup.list');
	
	const workgroups = await axios.get(url)
	.then((res) => {
		var workgroups = res.data.result.workgroups;
		
		for(let i = 0; i < workgroups.length; i++) {
			if(workgroups[i].def_pay_rate == null) {
				workgroups[i].def_pay_rate = 0;
			} else {
				workgroups[i].def_pay_rate = parseFloat(workgroups[i].def_pay_rate);
			}
		}
		
		return workgroups;
	}).catch((err) => {
		console.log(err, err.stack);
		
		return [];
	});
	
	// Assigning shift pay_rate by workgroup
	for(let i = 0; i < shifts.length; i++) {
		for(let j = 0; j < workgroups.length; j++) {
			if(shifts[i].workgroup && shifts[i].workgroup == workgroups[j].id) {
				shifts[i].pay_rate = workgroups[j].def_pay_rate;
			}
		}
	}

	// console.log(shifts);

	return shifts;
};

// Gets all accounts that are present in a set of shifts
const getUsers = async (shifts) => {

	var promises = [];
	var userIds = [];

    shifts.forEach((shift) => {
    	if(shift.covered && !userIds.includes(shift.covering_member)) {
    		
	    	userIds.push(shift.covering_member);
	    	
	    	var promise = axios.get(getUrl({
	    		id: shift.covering_member,
	    		extended: true
	    	}, 'account.get'))
	    	.then((res) => {
	    		return res.data.result;
	    	}).catch((err) => {
	    		console.log(err, err.stack);
	    		return Promise.reject(err);
	    	});
	    	
	    	promises.push(promise);
    	}
    });
    
	var users = await Promise.all(promises).then((values) => {

		var users = [];

		for(let i = 0; i < values.length; i++) {
			
			const value = values[i];
			
			var phone = value.mobile_phone;
			if(phone == null)
				phone = value.home_phone;
			
			const user = {
				id: value.id,
				email: value.email,
				name: value.screen_name,
				shifts: [],
				pay_rate: value.pay_rate,
				total_hours: 0,
				po: value.external_id ? value.external_id : 'attention required',
				address: value.address,
				address_second: value.address_seconds,
				city: value.city,
				state: value.state,
				zip: value.zip,
				phone: phone,
				timestamp: Date.now()
			};
			
		    if (user.pay_rate === null)
		      user.pay_rate = 0;
			
			for(let j = 0; j < shifts.length; j++) {
				
				const shift = shifts[j];
				
				if (shift.covered && shift.covering_member == user.id) {
					
					const start_date = Date.parse(shift.start_date);
					const end_date = Date.parse(shift.end_date);
					const duration = (end_date - start_date) / (1000*60*60);
					const subject = shift.subject;
					
					user.shifts.push({
						start_date,
						end_date,
						duration,
						pay_rate: shift.pay_rate ? shift.pay_rate : 0,
						subject,
						mileage: shift.mileage ? shift.mileage : 0,
						odcs: shift.odcs
					});
					
					user.total_hours += duration;
				}
			}
			
			users.push(user);
		}
		
		return users;
		
	}, (err) => {
		console.log(err);
	});
	
	// console.log(JSON.stringify(users, null, 2));
	
	return users;
};

// Gets all timecards during a given time period
const getAllTimecards = async () => {
	var timecards = [];
	
	const date = getEndDate();
	
	// Dates must be in YYYY-MM-DD format; e.g. 2019-06-30 where the 0 in the month field is required
	var end_date = date.getFullYear() + '-' + ((date.getMonth()+1) < 10 ? '0' : '') + (date.getMonth()+1) + '-' + (date.getDate() < 10 ? '0' : '') + date.getDate();
	
	date.setDate(date.getDate() - 13);
	
	var start_date = date.getFullYear() + '-' + ((date.getMonth()+1) < 10 ? '0' : '') + (date.getMonth()+1) + '-' + (date.getDate() < 10 ? '0' : '') + date.getDate();
	
	var params = {
		'select': {
			'start_date': start_date,//'2018-06-01',//start_date,
			'end_date': end_date//'2018-08-01'//end_date
		},
		'page': {
			'start': 1,
			'batch': 500
		},
		extended: true
	};
	
	// console.log(params);
	
	// Getting all timecard pages
	
	var url = getUrl(params, 'timecard.list');
	
	var res = await axios.get(url);
	
	while(res.data && res.data.result && res.data.result.page && res.data.result.page.next) {

		timecards = timecards.concat(res.data.result.timecards);
		
		params.page = res.data.result.page.next;
		
		url = getUrl(params, 'timecard.list');
		
		res = await axios.get(url);
		
	}
	
	if(res.data && res.data.result && res.data.result.page)
		timecards = timecards.concat(res.data.result.timecards);
	
	console.log(timecards.length);
	
	// Removing timecards that are not approved
	for(let i = 0; i < timecards.length; i++) {
		if(timecards[i].approved == false) {
			timecards.pop(i);
			i--;
			console.log('Not approved timecard removed.');
		} else {
			console.log('Approved timecard added.');
		}
	}
	
	return timecards;
};

// CRONJOB #1
// Generates and sends an invoice for each person who has worked during the pay period
const sendInvoices = () => {
	
	if(config.start_week === 0) {
	
		config.start_week++;
	
		getAllTimecards().then((timecards) => {
			
			getAllShifts(timecards).then(async (shifts) => {
				
				const users = await getUsers(shifts);
				
				for(var i = 0; i < users.length; i++) {
					
					const user = users[i];
					
					// console.log(i, JSON.stringify(user, null, 2));
					
					var shiftsList = [];
					
					for(var j = 0; j < user.shifts.length; j++) {
						
						const shift = user.shifts[j];
						
						if(shift.odcs === '' || shift.odcs === null) {
							shift.odcs = 0;
						}
						
						// Formatting shift to match dynamodb format
						shiftsList.push({
							M: {
								start_date: {
									N: shift.start_date.toString()
								},
								end_date: {
									N: shift.end_date.toString()
								},
								duration: {
									N: shift.duration.toString()
								},
								pay_rate: {
									N: shift.pay_rate.toString()
								},
								subject: {
									S: shift.subject === '' ? 'null' : shift.subject 
								},
								mileage: {
									N: shift.mileage.toString()
								},
								odcs: {
									N: shift.odcs.toString()
								}
							}
						});
						
					}
					
					user.token = crypto.createHmac('sha256', config.secret).update(JSON.stringify(user, null, 2)).digest('base64');
					
					// Formatting invoice/account to match dynamodb format
					const params = {
						Item: {
							id: {
								N: user.id.toString()
							},
							email: {
								S: user.email
							},
							name: {
								S: user.name
							},
							shifts: {
								L: shiftsList
							},
							pay_rate: {
								N: user.pay_rate.toString()
							},
							total_hours: {
								N: user.total_hours.toString()
							},
							po: {
								S: user.po === '' || !user.po ? 'PO# Missing' : user.po
							},
							address: {
								S: user.address === '' || !user.address ? 'Address Missing' : user.address
							},
							address_second: {
								S: user.address_second
							},
							city: {
								S: user.city === '' || !user.city ? 'City Missing' : user.city
							},
							state: {
								S: user.state === '' || !user.state ? 'State Missing' : user.state
							},
							zip: {
								S: user.zip === '' || !user.zip ? 'Zipcode Missing' : user.zip
							},
							phone: {
								S: user.phone === '' || !user.phone ? 'Phone Missing' : user.phone
							},
							token: {
								S: user.token
							},
							approved: {
								BOOL: false
							},
							timestamp: {
								N: user.timestamp.toString()
							}
						},
						ReturnConsumedCapacity: 'TOTAL',
						TableName: 'invoices'
					};
					
					if(user.address_second === '' || !user.address_second) {
						params.Item.address_second = { NULL: true };
					}
					
					// console.log(params);
					
					dynamodb.putItem(params, (err, data) => {
						
						if(err)
							console.log(err, err.stack);
					
						else
							console.log(data);
						
					});
					
				}
				
				batchSendInvoices(users);
				
				return users;
					
			}).catch((err) => console.log(err, err.stack));
		
			
		});
	} else if(config.start_week === 1) {
		config.start_week--;
	} else {
		config.start_week = 0;
	}
};

// EXPORTS
module.exports = {
	sendInvoices
};
