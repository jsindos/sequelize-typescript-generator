import { IndexType, IndexMethod, AbstractDataTypeConstructor } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { IConfig } from '../config';
import { createConnection } from "../connection";
import { AssociationsParser, IAssociationsParsed, IAssociationMetadata } from './AssociationsParser'
import { caseTransformer } from './utils';
import {parse} from "@typescript-eslint/parser";

export interface ITablesMetadata {
    [tableName: string]: ITableMetadata;
}

export interface ITableMetadata {
    name: string; // Model name
    originName: string; // Database table name
    schema?: 'public' | string; // Postgres only
    timestamps?: boolean;
    columns: {
        [columnName: string]: IColumnMetadata;
    }
    associations?: IAssociationMetadata[];
    comment?: string;
}

export interface IColumnMetadata {
    name: string; // Model field name
    originName: string; // Database column name
    type: string;
    typeExt: string;
    dataType?: string;
    primaryKey: boolean;
    foreignKey?: {
        name: string;
        targetModel: string;
    }
    allowNull: boolean;
    autoIncrement: boolean;
    indices?: IIndexMetadata[],
    comment?: string;
    // default?: ;
}

export interface IIndexMetadata {
    name: string;
    type?: IndexType;
    unique?: boolean;
    using?: IndexMethod;
    collation?: string | null;
    seq?: number;
}

export abstract class Dialect {

    /**
     * Accepted dialects
     */
    public static dialects: Set<string> = new Set([
        'postgres',
        'mysql',
        'mariadb',
        'sqlite',
        'mssql',
    ]);

    /**
     * Map database data type to sequelize data type
     * @param {string} dbType
     * @returns {string}
     */
    public abstract mapDbTypeToSequelize(dbType: string): AbstractDataTypeConstructor;

    /**
     * Map database data type to javascript data type
     * @param {string} dbType
     * @returns {string
     */
    public abstract mapDbTypeToJs(dbType: string): string;


    /**
     * Fetch table names for the provided database/schema
     * @param {Sequelize} connection
     * @param {IConfig} config
     * @returns {Promise<string[]>}
     */
    protected abstract async fetchTableNames(
        connection: Sequelize,
        config: IConfig
    ): Promise<string[]>;

    /**
     * Fetch columns metadata for the provided schema and table
     * @param {Sequelize} connection
     * @param {IConfig} config
     * @param {string} table
     * @returns {Promise<IColumnMetadata[]>}
     */
    protected abstract async fetchColumnsMetadata(
        connection: Sequelize,
        config: IConfig,
        table: string
    ): Promise<IColumnMetadata[]>;

    /**
     * Fetch index metadata for the provided table and column
     * @param {Sequelize} connection
     * @param {IConfig} config
     * @param {string} table
     * @param {string} column
     * @returns {Promise<IIndexMetadata[]>}
     */
    protected abstract async fetchColumnIndexMetadata(
        connection: Sequelize,
        config: IConfig,
        table: string,
        column: string
    ): Promise<IIndexMetadata[]>;

    /**
     * Build tables metadata for the specific dialect and schema
     * @param {IConfig} config
     * @returns {Promise<ITableMetadata[]>}
     */
    public async buildTablesMetadata(config: IConfig): Promise<ITablesMetadata> {
        let connection: Sequelize | undefined;
        const tablesMetadata: ITablesMetadata = {};

        try {
            // Set schema for Postgres to 'public' if not provided
            if (config.connection.dialect === 'postgres' && !config.metadata?.schema) {
                config.metadata = {
                    ...config.metadata,
                    ...{ schema: 'public'},
                };
            }

            connection = createConnection(config.connection);

            await connection.authenticate();

            let tables = await this.fetchTableNames(connection, config);

            // Apply filters
            tables = tables
                .filter(tableName => {
                    if (config.metadata?.tables?.length) {
                        return config.metadata.tables.includes(tableName.toLowerCase());
                    }
                    else {
                        return true;
                    }
                }).filter(tableName => {
                    if (config.metadata?.skipTables?.length) {
                        return !(config.metadata.skipTables.includes(tableName.toLowerCase()));
                    }
                    else {
                        return true;
                    }
                });

            for (const table of tables) {
                const columnsMetadata = await this.fetchColumnsMetadata(connection, config, table);

                // Fetch indices metadata if required
                if (config.metadata?.indices) {
                    for (const column of columnsMetadata) {
                        column.indices = await this.fetchColumnIndexMetadata(connection, config, table, column.name);
                    }
                }

                const tableMetadata: ITableMetadata = {
                    originName: table,
                    name: table,
                    ...config.metadata?.schema && { schema: config.metadata!.schema},
                    timestamps: config.metadata?.timestamps ?? false,
                    columns: {},
                    comment: '', // TODO
                };

                for (const columnMetadata of columnsMetadata) {
                    tableMetadata.columns[columnMetadata.name] = columnMetadata;
                }

                tablesMetadata[tableMetadata.originName] = tableMetadata;
            }
        }
        catch(err) {
            console.error(err);
            process.exit(1);
        }
        finally {
            connection && await connection.close();
        }

        // Apply associations if required
        if (config.metadata?.associationsFile) {
            const parsedAssociations = AssociationsParser.parse(config.metadata?.associationsFile);

            for (const [tableName, association] of Object.entries(parsedAssociations)) {
                if(!tablesMetadata[tableName]) {
                    console.warn('[WARNING]', `Associated table ${tableName} not found among (${Object.keys(tablesMetadata).join(', ')})`);
                    continue;
                }

                // Attach associations to table
                tablesMetadata[tableName].associations = association.associations;

                const { columns } = tablesMetadata[tableName];

                // Override foreign keys
                for (const { name: columnName, targetModel } of association.foreignKeys) {
                    if (!columns[columnName]) {
                        console.warn('[WARNING]', `Foreign key column ${columnName} not found among (${Object.keys(columns).join(', ')})`);
                        continue;
                    }

                    columns[columnName].foreignKey = {
                        name: columnName,
                        targetModel: targetModel
                    };
                }
            }
        }

        // Apply transformations if required
        if (config.metadata?.case) {
            for (const [tableName, tableMetadata] of Object.entries(tablesMetadata)) {
                tablesMetadata[tableName] = caseTransformer(tableMetadata, config.metadata.case);
            }
        }

        return tablesMetadata;
    }
}