try{process.loadEnvFile('.env.local');}catch{}
const express=require('express'),app=express();
app.get('/api/postal',require('../api/postal'));
app.use(express.static('dist'));app.listen(3001,'127.0.0.1',()=>console.log('Versão hospedada em http://127.0.0.1:3001'));
