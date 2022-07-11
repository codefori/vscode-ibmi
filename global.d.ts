
interface Action {
  name: string;
  command: string;
  type: "member"|"streamfile"|"object"|"file";
  environment: "ile"|"qsh"|"pase";
  extensions: string[];
  deployFirst?: boolean;
  postDownload?: string[];
}