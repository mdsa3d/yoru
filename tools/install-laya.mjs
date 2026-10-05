import {spawnSync} from 'node:child_process';
// CPU execution uses the binaries already bundled by onnxruntime-node.
// Skip its optional CUDA/TensorRT downloads (official ONNX installation option).
const r=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['install','--include=optional'],{stdio:'inherit',shell:process.platform==='win32',env:{...process.env,ONNXRUNTIME_NODE_INSTALL:'skip'}});
if(r.error)console.error(r.error.message);process.exitCode=r.status??1;
