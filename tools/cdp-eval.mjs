import {connect} from './cdp.mjs';
const client=await connect();
try {console.log(JSON.stringify(await client.evaluate(process.argv[2])));}
finally {client.close();}
