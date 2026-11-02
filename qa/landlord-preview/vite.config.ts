import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const repo=path.resolve(import.meta.dirname,'../..');
export default defineConfig({root:import.meta.dirname,publicDir:path.join(repo,'client/public'),plugins:[react()],resolve:{alias:{'@':path.join(repo,'client/src'),'@shared':path.join(repo,'shared')}},css:{postcss:repo},server:{host:'127.0.0.1',port:4194,strictPort:true,fs:{allow:[repo]}}});
