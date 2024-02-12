import prettyBytes from "pretty-bytes";
import type * as ftp from "qusly-core";
import {DiffResult, ErrorCode, IFilePath} from "./types";
import { ILogger, pluralize, retryRequest, ITimings } from "./utilities";

export async function ensureDir(client: ftp.Client, logger: ILogger, timings: ITimings, folder: string): Promise<void> {
    timings.start("changingDir");
    logger.verbose(`  changing dir to ${folder}`);

    await retryRequest(logger, async () => await client.createFolder(folder).catch(reason => {
        console.log(reason)
    }));

    logger.verbose(`  dir changed`);
    timings.stop("changingDir");
}

interface ISyncProvider {
    createFolder(folderPath: string): Promise<void>;
    removeFile(filePath: string): Promise<void>;
    removeFolder(folderPath: string): Promise<void>;

    /**
     * @param file file can include folder(s)
     * Note working dir is modified and NOT reset after upload
     * For now we are going to reset it - but this will be removed for performance
     */
    uploadFile(filePath: string, type: "upload" | "replace"): Promise<void>;

    syncLocalToServer(diffs: DiffResult): Promise<void>;
}

export class FTPSyncProvider implements ISyncProvider {
    constructor(client: ftp.Client, logger: ILogger, timings: ITimings, localPath: string, serverPath: string, stateName: string, dryRun: boolean) {
        this.client = client;
        this.logger = logger;
        this.timings = timings;
        this.localPath = localPath;
        this.serverPath = serverPath;
        this.stateName = stateName;
        this.dryRun = dryRun;
    }

    private client: ftp.Client;
    private logger: ILogger;
    private timings: ITimings;
    private localPath: string;
    serverPath: string;
    private dryRun: boolean;
    private stateName: string;


    /**
     * Converts a file path (ex: "folder/otherfolder/file.txt") to an array of folder and a file path
     * @param fullPath 
     */
    private getFileBreadcrumbs(fullPath: string): IFilePath {
        // todo see if this regex will work for nonstandard folder names
        // todo what happens if the path is relative to the root dir? (starts with /)
        const pathSplit = fullPath.split("/");
        const file = pathSplit?.pop() ?? ""; // get last item
        const folders = pathSplit.filter(folderName => folderName != "");

        return {
            folders: folders.length === 0 ? null : folders,
            file: file === "" ? null : file
        };
    }

    async createFolder(folderPath: string) {
        this.logger.all(`creating folder "${folderPath}"`);

        if (this.dryRun === true) {
            return;
        }

        const path = this.getFileBreadcrumbs(folderPath + "/");

        if (path.folders === null) {
            this.logger.verbose(`  no need to change dir`);
        }
        else {
            await ensureDir(this.client, this.logger, this.timings, path.folders.join("/"));
        }

        this.logger.verbose(`  completed`);
    }

    async removeFile(filePath: string) {
        this.logger.all(`removing "${filePath}"`);

        if (this.dryRun === false) {
            try {
                await retryRequest(this.logger, async () => await this.client.removeFile(filePath));
            }
            catch (e: any) {
                // this error is common when a file was deleted on the server directly
                if (e.code === ErrorCode.FileNotFoundOrNoAccess) {
                    this.logger.standard("File not found or you don't have access to the file - skipping...");
                }
                else {
                    throw e;
                }
            }
        }
        this.logger.verbose(`  file removed`);

        this.logger.verbose(`  completed`);
    }

    async removeFolder(folderPath: string) {
        const absoluteFolderPath = "/" + (this.serverPath.startsWith("./") ? this.serverPath.replace("./", "") : this.serverPath) + folderPath;
        this.logger.all(`removing folder "${absoluteFolderPath}"`);

        if (this.dryRun === false) {
            await retryRequest(this.logger, async () => await this.client.removeFolder(absoluteFolderPath));
        }

        this.logger.verbose(`  completed`);
    }

    async uploadFile(filePath: string, type: "upload" | "replace" = "upload") {
        const typePresent = type === "upload" ? "uploading" : "replacing";
        const typePast = type === "upload" ? "uploaded" : "replaced";
        this.logger.all(`${typePresent} "${filePath}"`);

        if (this.dryRun === false) {
            await retryRequest(this.logger, async () => await this.client.upload(this.localPath + filePath.substring(this.serverPath.length), filePath));
        }

        this.logger.verbose(`  file ${typePast}`);
    }

    async syncLocalToServer(diffs: DiffResult) {
        const totalCount = diffs.delete.length + diffs.upload.length + diffs.replace.length;

        this.logger.all(`----------------------------------------------------------------`);
        this.logger.all(`Making changes to ${totalCount} ${pluralize(totalCount, "file/folder", "files/folders")} to sync server state`);
        this.logger.all(`Uploading: ${prettyBytes(diffs.sizeUpload)} -- Deleting: ${prettyBytes(diffs.sizeDelete)} -- Replacing: ${prettyBytes(diffs.sizeReplace)}`);
        this.logger.all(`----------------------------------------------------------------`);

        // create new folders
        for (const file of diffs.upload.filter(item => item.type === "folder")) {
            await this.createFolder(this.serverPath + file.name).catch(reason => {
                console.log(reason)
            })
        }

        // upload new files
        for (const file of diffs.upload.filter(item => item.type === "file").filter(item => item.name !== this.stateName)) {
            await this.uploadFile(this.serverPath + file.name, "upload").catch(reason => {
                console.log(reason)
            })
        }

        // replace new files
        for (const file of diffs.replace.filter(item => item.type === "file").filter(item => item.name !== this.stateName)) {
            // note: FTP will replace old files with new files. We run replacements after uploads to limit downtime
            await this.uploadFile(this.serverPath + file.name, "replace").catch(reason => {
                console.log(reason)
            })
        }

        // delete old files
        for (const file of diffs.delete.filter(item => item.type === "file")) {
            await this.removeFile(this.serverPath + file.name).catch(reason => {
                console.log(reason)
            })
        }

        // delete old folders
        for (const file of diffs.delete.filter(item => item.type === "folder")) {
            await this.removeFolder(this.serverPath + file.name).catch(reason => {
                console.log(reason)
            })
        }

        this.logger.all(`----------------------------------------------------------------`);
        this.logger.all(`🎉 Sync complete. Saving current server state to "${this.serverPath + this.stateName}"`);
        if (this.dryRun === false) {
            await retryRequest(this.logger, async () => await this.client.upload(this.localPath + this.stateName, this.serverPath + this.stateName));
        }
    }
}
