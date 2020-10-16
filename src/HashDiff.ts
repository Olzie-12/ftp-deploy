import { IDiff, IFileList, Record } from "./types";
import { ILogger } from "./utilities";

function formatNumber(number: number): string {
    return number.toLocaleString();
}

export class HashDiff implements IDiff {
    getDiffs(localFiles: IFileList, serverFiles: IFileList, logger: ILogger) {
        const uploadList: Record[] = [];
        const deleteList: Record[] = [];
        const replaceList: Record[] = [];

        let sizeUpload = 0;
        let sizeDelete = 0;
        let sizeReplace = 0;

        // alphabetize each list based off path
        const localFilesSorted = localFiles.data.sort((first, second) => first.name.localeCompare(second.name));
        const serverFilesSorted = serverFiles.data.sort((first, second) => first.name.localeCompare(second.name));

        logger.standard(`----------------------------------------------------------------`);
        logger.standard(`Local Files:\t${formatNumber(localFilesSorted.length)}`);
        logger.standard(`Server Files:\t${formatNumber(localFilesSorted.length)}`);
        logger.standard(`----------------------------------------------------------------`);
        logger.standard(`Calculating differences between client & server`);
        logger.standard(`----------------------------------------------------------------`);

        let localPosition = 0;
        let serverPosition = 0;
        while (localPosition + serverPosition < localFilesSorted.length + serverFilesSorted.length) {
            let localFile: Record | undefined = localFilesSorted[localPosition];
            let serverFile: Record | undefined = serverFilesSorted[serverPosition];

            let fileNameCompare = 0;
            if (localFile === undefined) {
                fileNameCompare = 1;
            }
            if (serverFile === undefined) {
                fileNameCompare = -1;
            }
            if (localFile !== undefined && serverFile !== undefined) {
                fileNameCompare = localFile.name.localeCompare(serverFile.name);
            }

            if (fileNameCompare < 0) {
                let icon = localFile.type === "folder" ? `📁 Create` : `➕ Upload`;

                logger.standard(`${icon}: ${localFile.name}`);
                uploadList.push(localFile);
                sizeUpload += localFile.size ?? 0;
                localPosition += 1;
            }
            else if (fileNameCompare > 0) {
                let icon = serverFile.type === "folder" ? `📁` : `🗑️`;

                logger.standard(`${icon}  Delete: ${serverFile.name}    `);
                deleteList.push(serverFile);
                sizeDelete += serverFile.size ?? 0;
                serverPosition += 1;
            }
            else if (fileNameCompare === 0) {
                // paths are a match
                if (localFile.type === "file" && serverFile.type === "file") {
                    if (localFile.hash === serverFile.hash) {
                        logger.standard(`⚖️  File content is the same, doing nothing: ${localFile.name}`);
                    }
                    else {
                        logger.standard(`🔁 File replace: ${localFile.name}`);
                        sizeReplace += localFile.size ?? 0;
                        replaceList.push(localFile);
                    }
                }

                localPosition += 1;
                serverPosition += 1;
            }
        }


        return {
            upload: uploadList,
            delete: deleteList,
            replace: replaceList,
            sizeDelete,
            sizeReplace,
            sizeUpload
        };
    }
}
