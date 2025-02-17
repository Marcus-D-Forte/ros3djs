/**
 * @author David V. Lu!! - davidvlu@gmail.com
 * @author Mathieu Bredif - mathieu.bredif@ign.fr
 */

/**
 * Decodes the base64-encoded array 'inbytes' into the array 'outbytes'
 * until 'inbytes' is exhausted or 'outbytes' is filled.
 * if 'record_size' is specified, records of length 'record_size' bytes
 * are copied every other 'pointRatio' records.
 * returns the number of decoded records
 */
 function decode64(inbytes, outbytes, record_size, pointRatio) {
  var x,b=0,l=0,j=0,L=inbytes.length,A=outbytes.length;
  record_size = record_size || A; // default copies everything (no skipping)
  pointRatio = pointRatio || 1; // default copies everything (no skipping)
  var bitskip = (pointRatio-1) * record_size * 8;
  for(x=0;x<L&&j<A;x++){
      b=(b<<6)+decode64.e[inbytes.charAt(x)];
      l+=6;
      if(l>=8){
          l-=8;
          outbytes[j++]=(b>>>l)&0xff;
          if((j % record_size) === 0) { // skip records
              // no    optimization: for(var i=0;i<bitskip;x++){l+=6;if(l>=8) {l-=8;i+=8;}}
              // first optimization: for(;l<bitskip;l+=6){x++;} l=l%8;
              x += Math.ceil((bitskip - l) / 6);
              l = l % 8;

              if(l>0){b=decode64.e[inbytes.charAt(x)];}
          }
      }
  }
  return Math.floor(j/record_size);
}
// initialize decoder with static lookup table 'e'
decode64.S='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
decode64.e={};
for(var i=0;i<64;i++){decode64.e[decode64.S.charAt(i)]=i;}


/**
* A PointCloud2 client that listens to a given topic and displays the points.
*
* @constructor
* @param options - object with following keys:
*
*  * ros - the ROSLIB.Ros connection handle
*  * topic - the marker topic to listen to (default: '/points')
*  * tfClient - the TF client handle to use
*  * compression (optional) - message compression (default: 'cbor')
*  * rootObject (optional) - the root object to add this marker to use for the points.
*  * max_pts (optional) - number of points to draw (default: 10000)
*  * pointRatio (optional) - point subsampling ratio (default: 1, no subsampling)
*  * messageRatio (optional) - message subsampling ratio (default: 1, no subsampling)
*  * material (optional) - a material object or an option to construct a PointsMaterial.
*  * colorsrc (optional) - the field to be used for coloring (default: 'rgb')
*  * colormap (optional) - function that turns the colorsrc field value to a color
*/
ROS3D.PointCloud2 = function(options) {
options = options || {};
this.ros = options.ros;
this.topicName = options.topic || '/points';
this.throttle_rate = options.throttle_rate || null;
this.compression = options.compression || 'cbor';
this.max_pts = options.max_pts || 10000;
this.points = new ROS3D.Points(options);
this.lastMessages = [];
this.decayTime = options.decay || 1;
this.rosTopic = undefined;
this.buffer = null;
this.subscribe();
};
ROS3D.PointCloud2.prototype.__proto__ = THREE.Object3D.prototype;


ROS3D.PointCloud2.prototype.unsubscribe = function(){
if(this.rosTopic){
  this.rosTopic.unsubscribe();
}
};

ROS3D.PointCloud2.prototype.subscribe = function(){
this.unsubscribe();

// subscribe to the topic
this.rosTopic = new ROSLIB.Topic({
  ros : this.ros,
  name : this.topicName,
  messageType : 'sensor_msgs/msg/PointCloud2',
  throttle_rate : this.throttle_rate,
  queue_length : 1,
  compression: this.compression
});
this.rosTopic.subscribe(this.processMessage.bind(this));
};

ROS3D.PointCloud2.prototype.processMessage = function(msg){
if(!this.points.setup(msg.header.frame_id, msg.point_step, msg.fields)) {
    return;
}

var n, pointRatio = this.points.pointRatio;
var bufSz = this.max_pts * msg.point_step;

// decode message buffer
if (msg.data.buffer) {
  this.buffer = msg.data.slice(0, Math.min(msg.data.byteLength, bufSz));
   n = Math.min(msg.height*msg.width / pointRatio, this.points.positions.array.length / 3);
} else {
  if (!this.buffer || this.buffer.byteLength < bufSz) {
    this.buffer = new Uint8Array(bufSz);
  }
  n = decode64(msg.data, this.buffer, msg.point_step, pointRatio);
  pointRatio = 1;
}

var dv = new DataView(this.buffer.buffer);
var littleEndian = !msg.is_bigendian;
var x = this.points.fields.x.offset;
var y = this.points.fields.y.offset;
var z = this.points.fields.z.offset;
var base, color;

// allocate buffers to hold point data from the new message
var newPointCount = n;
var newPositions = new Array(newPointCount);
var newColors = this.points.colors ? new Array(newPointCount) : undefined;

// read data points from message and store them in the allocated buffers
for(var i = 0; i < n; i++){
  base = i * pointRatio * msg.point_step;
  newPositions[3*i    ] = dv.getFloat32(base+x, littleEndian);
  newPositions[3*i + 1] = dv.getFloat32(base+y, littleEndian);
  newPositions[3*i + 2] = dv.getFloat32(base+z, littleEndian);

  if(this.points.colors){
      color = this.points.colormap(this.points.getColor(dv,base,littleEndian));
      newColors[3*i    ] = color.r;
      newColors[3*i + 1] = color.g;
      newColors[3*i + 2] = color.b;
  }
}

// append newly read data to the message history array and discard old data
this.lastMessages.push({ count: newPointCount, positions: newPositions, colors: newColors });
if(this.lastMessages.length > this.decayTime){
  this.lastMessages = this.lastMessages.splice(this.lastMessages.length - this.decayTime);
}

// write data points from message history to this.points
var arraySize = this.points.positions.array.length;
let addedPointCount = 0;
// reverse loop -> start with newer data in case we have more points than can be displayed
for(var i = this.lastMessages.length - 1; i >= 0 && addedPointCount < arraySize; i--){
var message = this.lastMessages[i];
for(var j = 0; j < message.count && addedPointCount < arraySize; j++){
  this.points.positions.array[addedPointCount * 3 + 0] = message.positions[j * 3 + 0];
  this.points.positions.array[addedPointCount * 3 + 1] = message.positions[j * 3 + 1];
  this.points.positions.array[addedPointCount * 3 + 2] = message.positions[j * 3 + 2];
  
    if(this.points.colors){
    this.points.colors.array[addedPointCount * 3 + 0] = message.colors[j * 3 + 0];
    this.points.colors.array[addedPointCount * 3 + 1] = message.colors[j * 3 + 1];
    this.points.colors.array[addedPointCount * 3 + 2] = message.colors[j * 3 + 2];
    }
  
  addedPointCount++;
}
}

// send update message to this.points
this.points.update(addedPointCount);
};
