import { DataTypeProvider, VirtualTableState } from '@devexpress/dx-react-grid';
import { Grid, TableHeaderRow, VirtualTable } from '@devexpress/dx-react-grid-material-ui';
import Confirm from '@iobroker/adapter-react/Dialogs/Confirm';
import Button from '@material-ui/core/Button';
import ButtonGroup from '@material-ui/core/ButtonGroup';
import Chip from '@material-ui/core/Chip';
import Paper from '@material-ui/core/Paper';
import Tooltip from '@material-ui/core/Tooltip';
import Typography from '@material-ui/core/Typography';
import Build from '@material-ui/icons/Build';
import DeleteForever from '@material-ui/icons/DeleteForever';
import GetApp from '@material-ui/icons/GetApp';
import HelpOutline from '@material-ui/icons/HelpOutline';
import Update from '@material-ui/icons/Update';
import SearchBar from 'material-ui-search-bar';
import React, { useEffect, useReducer, useState } from 'react';
import ConfigDialog from './config-dialog';

const VIRTUAL_PAGE_SIZE = 50;
const SEARCH_URL = 'https://api.npms.io/v2/search?q=keywords:homebridge-plugin';
const INFO_URL = 'https://api.npms.io/v2/package/mget';
const UNKNOWN_VERSION = '?';
const getRowId = (row) => row.package.name;
const buildQueryString = (skip, take, search) =>
    `${SEARCH_URL}${!!search ? encodeURIComponent(' ' + search) : ''}&from=${skip}&size=${take}`;

const initialState = {
    rows: [],
    skip: 0,
    requestedSkip: 0,
    take: VIRTUAL_PAGE_SIZE * 2,
    totalCount: 0,
    loading: false,
    lastQuery: '',
    lastAdapterConfigJson: '{}',
    search: '',
    openConfig: undefined,
    confirmDelete: undefined,
};

function reducer(state, { type, payload }) {
    //console.log('reducer', type, payload);
    switch (type) {
        case 'UPDATE_ROWS':
            return {
                ...state,
                ...payload,
                loading: false,
            };
        case 'START_LOADING':
            return {
                ...state,
                requestedSkip: payload.requestedSkip,
                take: payload.take,
            };
        case 'REQUEST_ERROR':
            return {
                ...state,
                loading: false,
            };
        case 'FETCH_INIT':
            return {
                ...state,
                loading: true,
            };
        case 'UPDATE_CACHE':
            return {
                ...state,
                lastQuery: payload.query,
                lastAdapterConfigJson: JSON.stringify(payload.adapterConfig),
            };
        case 'CHANGE_SEARCH':
            return {
                ...state,
                typingSearch: payload,
            };
        case 'EXECUTE_SEARCH':
            return {
                ...state,
                search: state.typingSearch,
                rows: state.search !== state.typingSearch ? [] : state.rows,
            };
        case 'CLEAR_SEARCH':
            return {
                ...state,
                search: '',
                rows: state.search ? [] : state.rows,
            };
        case 'OPEN_CONFIG':
            return {
                ...state,
                openConfig: payload,
            };
        case 'INSTALL_CONFIG':
            return {
                ...state,
                installConfig: payload,
            };
        case 'CLOSE_CONFIG':
            return {
                ...state,
                openConfig: undefined,
                installConfig: undefined,
            };
        case 'CONFIRM_DELETE':
            return {
                ...state,
                confirmDelete: payload,
            };
        default:
            return state;
    }
}

const filterKeywords = (keyword) => {
    return keyword.indexOf('homebridge') === -1 && keyword.indexOf('homekit') === -1;
};

const cleanModuleName = (name) => {
    return name
        .replace('homebridge-', '')
        .replace('-homebridge', '')
        .replace(/^@.+?\//, '');
};

const Root = (props) => <Grid.Root {...props} style={{ height: 'calc(100% - 64px)' }} />;

export default ({ adapterConfig, onChange, showToast }) => {
    const [state, dispatch] = useReducer(reducer, initialState);
    const [columns] = useState([
        { name: 'name', title: 'Name', getCellValue: (row) => cleanModuleName(row.package.name) },
        { name: 'actions', title: 'Actions', getCellValue: (row) => row },
        { name: 'description', title: 'Description', getCellValue: (row) => row.package.description },
        { name: 'installed', title: 'Installed', getCellValue: (row) => row.installed },
        { name: 'available', title: 'Available', getCellValue: (row) => row.package.version },
        { name: 'keywords', title: 'Keywords', getCellValue: (row) => row.package.keywords.filter(filterKeywords) },
    ]);
    const [tableColumnExtensions] = useState([
        { columnName: 'name', width: 200 },
        { columnName: 'actions', width: 200 },
        { columnName: 'installed', width: 80 },
        { columnName: 'available', width: 80 },
        { columnName: 'keywords', width: 300 },
    ]);

    const getRemoteRows = (requestedSkip, take) => {
        dispatch({ type: 'START_LOADING', payload: { requestedSkip, take } });
    };

    const prependInstalled = (results, total, installed, search) => {
        if (!installed || installed.length === 0) {
            return Promise.resolve({ results, total });
        }

        let filterSearch = () => true;
        if (!!search) {
            const searchTerms = search
                .split(/\s+/)
                .filter((t) => !!t)
                .map((t) => t.toLowerCase());
            filterSearch = (item) =>
                !searchTerms.filter(
                    (t) =>
                        !item.package.name.toLowerCase().includes(t) &&
                        !item.package.description.toLowerCase().includes(t) &&
                        !item.package.keywords.filter((k) => k.toLowerCase().includes(t)).length,
                ).length;
        }

        const versions = {};
        const names = [];
        installed
            .map((m) => m.split('@'))
            .forEach((parts) => {
                names.push(parts[0]);
                versions[parts[0]] = parts[1];
            });

        return fetch(INFO_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify(names),
        })
            .then((response) => response.json())
            .then((data) => {
                const keys = [];
                for (const key in data) {
                    keys.push(key);
                }
                keys.sort();
                results = results.filter((r) => !names.includes(r.package.name));
                results.unshift(
                    ...keys
                        .map((k) => ({
                            package: data[k].collected.metadata,
                            installed: versions[k] || UNKNOWN_VERSION,
                        }))
                        .filter(filterSearch),
                );
                return { results, total };
            });
    };

    const installed = adapterConfig.libraries.split(/[,;\s]+/).filter((p) => !!p);
    const loadData = () => {
        const { requestedSkip, take, search, lastQuery, lastAdapterConfigJson, loading } = state;
        const query = buildQueryString(requestedSkip, take, search);
        if ((query !== lastQuery || JSON.stringify(adapterConfig) !== lastAdapterConfigJson) && !loading) {
            dispatch({ type: 'FETCH_INIT' });
            fetch(query)
                .then((response) => response.json())
                .then(({ results, total }) =>
                    prependInstalled(results, total, requestedSkip === 0 ? installed : [], search),
                )
                .then(({ results, total }) => {
                    dispatch({
                        type: 'UPDATE_ROWS',
                        payload: {
                            skip: requestedSkip,
                            rows: results,
                            totalCount: total,
                        },
                    });
                })
                .catch(() => dispatch({ type: 'REQUEST_ERROR' }));
            dispatch({ type: 'UPDATE_CACHE', payload: { query, adapterConfig } });
        }
    };

    useEffect(() => loadData());

    const { rows, skip, totalCount, loading, search, openConfig, installConfig, confirmDelete } = state;

    const PackageNameFormatter = ({ value, row }) => {
        return (
            <Tooltip title={row.package.name}>
                {row.installed ? <strong>{value}</strong> : <Typography>{value}</Typography>}
            </Tooltip>
        );
    };

    const ToolTipButton = ({ tooltip, disabled, Icon, ...other }) => {
        return !!disabled ? (
            <Button disabled={true} {...other}>
                <Icon />
            </Button>
        ) : (
            <Tooltip title={tooltip}>
                <Button {...other}>
                    <Icon />
                </Button>
            </Tooltip>
        );
    };

    const onConfigureClicked = (row) => {
        const versionPostfix = row.installed === UNKNOWN_VERSION ? '' : `@${row.installed}`;
        dispatch({ type: 'OPEN_CONFIG', payload: `${row.package.name}${versionPostfix}` });
    };

    const onUpdateOrInstallClicked = (row) => {
        const packageRef = `${row.package.name}@${row.package.version}`;
        if (row.installed) {
            const index = installed.findIndex((m) => m.startsWith(`${row.package.name}@`) || m === row.package.name);
            if (index !== -1) {
                installed[index] = packageRef;
                showToast(`${row.package.name} will be updated to ${row.package.version}`);
                onChange({ libraries: installed.join(' ') });
            }
        } else {
            dispatch({ type: 'INSTALL_CONFIG', payload: packageRef });
        }
    };

    const onDeleteClicked = (row) => {
        dispatch({ type: 'CONFIRM_DELETE', payload: row.package.name });
    };

    const onDeleteConfirmed = (ok) => {
        dispatch({ type: 'CONFIRM_DELETE' }); // closes the dialog by clearing "confirmDelete"
        const index = installed.findIndex((m) => m.startsWith(`${confirmDelete}@`) || m === confirmDelete);
        if (ok && index !== -1) {
            installed.splice(index, 1);
            showToast(`${confirmDelete} will be removed`);
            onChange({ libraries: installed.join(' ') });
        }
    };

    const ActionsFormatter = ({ row }) => {
        return (
            <ButtonGroup size="small" aria-label="outlined primary button group">
                <ToolTipButton tooltip="Readme" Icon={HelpOutline} target="_blank" href={row.package.links.homepage} />
                <ToolTipButton
                    tooltip={row.installed ? 'Update' : 'Install'}
                    disabled={row.installed && row.installed === row.package.version}
                    Icon={row.installed ? Update : GetApp}
                    onClick={() => onUpdateOrInstallClicked(row)}
                />
                <ToolTipButton
                    tooltip="Configure"
                    disabled={!row.installed}
                    Icon={Build}
                    onClick={() => onConfigureClicked(row)}
                />
                <ToolTipButton
                    tooltip="Remove"
                    disabled={!row.installed}
                    Icon={DeleteForever}
                    onClick={() => onDeleteClicked(row)}
                />
            </ButtonGroup>
        );
    };

    const KeywordsFormatter = ({ value }) => {
        return value.map((k) => <Chip key={k} variant="outlined" size="small" label={k} />);
    };

    const onDialogClose = ({ save, wrapperConfig }) => {
        if (save) {
            if (installConfig) {
                installed.push(installConfig);
                showToast(`${installConfig} will be installed`);
                onChange({ wrapperConfig, libraries: installed.join(' ') });
            } else {
                onChange({ wrapperConfig });
            }
        }
        dispatch({ type: 'CLOSE_CONFIG' });
    };

    return (
        <div style={{ height: '100%' }}>
            <SearchBar
                value={search}
                onChange={(newValue) => dispatch({ type: 'CHANGE_SEARCH', payload: newValue })}
                onRequestSearch={() => dispatch({ type: 'EXECUTE_SEARCH' })}
                onCancelSearch={() => dispatch({ type: 'CLEAR_SEARCH' })}
                style={{ marginBottom: '8px' }}
            />
            <div style={{ flex: '1 1 auto' }}>
                <Paper>
                    <Grid rows={rows} columns={columns} getRowId={getRowId} rootComponent={Root}>
                        <DataTypeProvider formatterComponent={ActionsFormatter} for={['actions']} />
                        <DataTypeProvider formatterComponent={PackageNameFormatter} for={['name']} />
                        <DataTypeProvider formatterComponent={KeywordsFormatter} for={['keywords']} />
                        <VirtualTableState
                            loading={loading}
                            totalRowCount={totalCount}
                            pageSize={VIRTUAL_PAGE_SIZE}
                            skip={skip}
                            getRows={getRemoteRows}
                        />
                        <VirtualTable columnExtensions={tableColumnExtensions} />
                        <TableHeaderRow />
                    </Grid>
                </Paper>
            </div>
            <ConfigDialog
                moduleName={openConfig || installConfig}
                isNew={!!installConfig}
                wrapperConfig={adapterConfig.wrapperConfig}
                onClose={onDialogClose}
            />
            {confirmDelete && (
                <Confirm text={`Do you really want to remove ${confirmDelete}?`} onClose={onDeleteConfirmed} />
            )}
        </div>
    );
};
