Welcome to GDIT's Shiftboard 1099 Invoicing System

This program will generate invoices for all 1099s who have worked within the
past two weeks and send them by email for approval. Once approved, the invoices
are sent to Accounts Payable to be processed.

How to run:
Simple debug mode:
'npm start' or 'npm start > log.txt'

Production:
'docker built -t insert_desired_image_name .'
'docker run -p 8080:8080 -d insert_desired_image_name'
The application should now be running in a docker container on port 8080.
To allow the application to use port 80 (the default http port), set up
a reverse proxy using nginx or apache. This is set up this way in the case
of a potential hack, where the infiltrating code will not have access to 
superuser privileges.

Important File Descriptions:
-- tools/cronJobs.js
This file contains code that runs on a biweekly basis.
It is where all the data in shiftboard is pulled.

-- tools/email.js
This file contains the code that is run for generating the emails and sending 
them to the 1099's or to Accounts Payable.

-- routes/invoices.js
This file contains the code that executes when a 1099 approves an invoice.
The information is pulled from the database to generate a new invoice for AP.

-- config/config.js
This is the configuration file where configuration can be done to customize
the tool. Information, such as API keys, secrets, signatures, and passwords,
is set into variables here, but the sensitive information should be stored in
the environment variables for security reasons.

-- .env
This is the environment variables file where sensitive information is stored.
This file must be created, as it is not located in the git repository for
security reasons. The variables may be filled out on the "example.env" file,
then renamed to ".env". The variables that this file contains are:
1. SECRET is a variable you can set to be the secret for token generation
2. EMAIL_USER is the username of the email to send from, e.g. <noreply@gmail.com>
3. EMAIL_PASS is the password of the email account
4. SB_ACCESS_KEY is the access key for shiftboard
5. SB_SIGNATURE is the signature for shiftboard
6. AP_EMAIL is the destination to send the invoice once it's approved
7. IP_ADDRESS is the IP address of the server (it can also be a site e.g. www.example.com (do not put "http://"))
8. ADMIN_EMAIL is the email to contact if an invoice contains errors