declare module 'winston-daily-rotate-file' {
  import * as winston from 'winston';
  import * as Transport from 'winston-transport';

  interface DailyRotateFileTransportOptions extends Transport.TransportStreamOptions {
    filename: string;
    datePattern?: string;
    maxSize?: string | number;
    maxFiles?: string | number;
    zippedArchive?: boolean;
    createSymlink?: boolean;
    symlinkName?: string;
    level?: string;
    format?: winston.Logform.Format;
  }

  class DailyRotateFile extends Transport {
    constructor(options: DailyRotateFileTransportOptions);
  }

  export = DailyRotateFile;
}

declare module 'winston/lib/winston/transports' {
  interface Transports {
    DailyRotateFile: typeof import('winston-daily-rotate-file');
  }
}