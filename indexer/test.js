/**
 * @author "Fabio Cigliano"
 * @created 14/08/18
 */

var index = require('./index')

console.log('process.env.ORIGINAL_BUCKET', process.env.ORIGINAL_BUCKET)

index.handler(null, null)
