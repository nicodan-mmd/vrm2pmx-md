declare module "three/examples/jsm/loaders/MMDLoader.js" {
  import { Loader, LoadingManager, SkinnedMesh } from "three";

  export class MMDLoader extends Loader {
    constructor(manager?: LoadingManager);
    load(
      url: string,
      onLoad: (mesh: SkinnedMesh) => void,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
      onError?: (error: unknown) => void,
    ): void;
    loadAsync(
      url: string,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
    ): Promise<SkinnedMesh>;
  }
}
