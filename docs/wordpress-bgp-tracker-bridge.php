<?php
/**
 * Plugin Name: BGP Tracker Bridge
 * Description: Opens Listings, Recent Projects and their ACF fields to the REST API so the BGP dashboard can keep the website's listings in step with the leasing tracker. No front-end changes.
 * Version: 1.5.0
 * Author: Bruce Gillingham Pollard
 */

if (!defined('ABSPATH')) { exit; }

// Listings + Recent Projects over REST (the theme registers them without show_in_rest).
add_filter('register_post_type_args', function ($args, $type) {
    if (in_array($type, array('listings', 'project'), true)) {
        $args['show_in_rest'] = true;
        if (empty($args['rest_base'])) { $args['rest_base'] = $type; }
    }
    return $args;
}, 10, 2);

add_filter('register_taxonomy_args', function ($args, $taxonomy) {
    if (in_array($taxonomy, array('location', 'type', 'project_type'), true)) {
        $args['show_in_rest'] = true;
    }
    return $args;
}, 10, 2);

// Every ACF field group readable/writable through REST (acf key on the post).
add_filter('acf/load_field_group', function ($group) {
    if (is_array($group)) { $group['show_in_rest'] = 1; }
    return $group;
});

// Tracker unit id on a listing, so the sync can find the post it made.
// (REST meta needs custom-fields support on the post type.)
add_action('init', function () {
    add_post_type_support('listings', 'custom-fields');
    add_post_type_support('project', 'custom-fields');
    register_post_meta('listings', 'bgp_unit_id', array(
        'type' => 'string', 'single' => true, 'show_in_rest' => true,
        'auth_callback' => function () { return current_user_can('edit_posts'); },
    ));
    foreach (array('bgp_synced_at', 'bgp_signature') as $key) {
        register_post_meta('listings', $key, array(
            'type' => 'string', 'single' => true, 'show_in_rest' => true,
            'auth_callback' => function () { return current_user_can('edit_posts'); },
        ));
    }
});

// GET /wp-json/wp/v2/listings?bgp_unit_id=... and ?bgp_synced=1 (only tracker-made listings).
add_filter('rest_listings_query', function ($args, $request) {
    $meta = array();
    if ($request->get_param('bgp_unit_id')) {
        $meta[] = array('key' => 'bgp_unit_id', 'value' => sanitize_text_field($request->get_param('bgp_unit_id')));
    }
    if ($request->get_param('bgp_synced')) {
        $meta[] = array('key' => 'bgp_unit_id', 'compare' => 'EXISTS');
    }
    if ($meta) { $args['meta_query'] = $meta; }
    return $args;
}, 10, 2);

// ACF read/write for the dashboard, independent of the ACF REST API version.
//   GET  /wp-json/bgp/v1/acf-schema/<post_id>   field groups + fields (keys, names, types, sub fields, layouts)
//   GET  /wp-json/bgp/v1/acf/<post_id>          raw field values (attachment ids, not urls)
//   POST /wp-json/bgp/v1/acf/<post_id>          {"fields": {"field_abc123": value, ...}} -> update_field per key
add_action('rest_api_init', function () {
    $can = function ($request) {
        $id = (int) $request['id'];
        return $id > 0 && current_user_can('edit_post', $id);
    };
    $schema = function ($request) {
        if (!function_exists('acf_get_field_groups')) { return new WP_Error('no_acf', 'ACF not active', array('status' => 500)); }
        $id = (int) $request['id'];
        $out = array('post_id' => $id, 'post_type' => get_post_type($id), 'groups' => array());
        foreach (acf_get_field_groups(array('post_id' => $id)) as $group) {
            $out['groups'][] = array('key' => $group['key'], 'title' => $group['title'], 'fields' => acf_get_fields($group));
        }
        return rest_ensure_response($out);
    };
    $read = function ($request) {
        $id = (int) $request['id'];
        return rest_ensure_response(array('post_id' => $id, 'fields' => function_exists('get_fields') ? get_fields($id, false) : null, 'acf_version' => defined('ACF_VERSION') ? ACF_VERSION : null));
    };
    $write = function ($request) {
        $id = (int) $request['id'];
        $body = $request->get_json_params();
        if (!is_array($body) || !isset($body['fields']) || !is_array($body['fields'])) {
            return new WP_Error('bad_body', 'Expected {"fields": {field_key: value}}', array('status' => 400));
        }
        $done = array();
        foreach ($body['fields'] as $key => $value) {
            $done[$key] = update_field($key, $value, $id);
        }
        // Optional {"meta": {"bgp_unit_id": "...", ...}} — plain post meta, bgp_ keys only.
        if (isset($body['meta']) && is_array($body['meta'])) {
            foreach ($body['meta'] as $key => $value) {
                if (strpos($key, 'bgp_') === 0) { update_post_meta($id, sanitize_key($key), is_scalar($value) ? (string) $value : wp_json_encode($value)); }
            }
        }
        return rest_ensure_response(array('post_id' => $id, 'updated' => $done, 'fields' => get_fields($id, false)));
    };
    // GET /wp-json/bgp/v1/acf-bulk/<post_type>?status=publish,draft  -> every post of that type with its raw ACF values
    $bulk = function ($request) {
        $type = sanitize_key($request['type']);
        if (!post_type_exists($type)) { return new WP_Error('bad_type', 'Unknown post type', array('status' => 400)); }
        $status = array_filter(array_map('sanitize_key', explode(',', (string) ($request->get_param('status') ?: 'publish'))));
        $posts = get_posts(array('post_type' => $type, 'post_status' => $status, 'numberposts' => -1, 'orderby' => 'ID', 'order' => 'ASC'));
        $out = array();
        foreach ($posts as $p) {
            $out[] = array('id' => $p->ID, 'slug' => $p->post_name, 'status' => $p->post_status, 'title' => $p->post_title, 'date' => $p->post_date, 'modified' => $p->post_modified,
                'featured_media' => (int) get_post_thumbnail_id($p->ID), 'meta' => array('bgp_unit_id' => get_post_meta($p->ID, 'bgp_unit_id', true), 'bgp_synced_at' => get_post_meta($p->ID, 'bgp_synced_at', true), 'bgp_signature' => get_post_meta($p->ID, 'bgp_signature', true)),
                'terms' => wp_get_object_terms($p->ID, get_object_taxonomies($type), array('fields' => 'all')), 'fields' => get_fields($p->ID, false));
        }
        return rest_ensure_response($out);
    };
    register_rest_route('bgp/v1', '/acf-bulk/(?P<type>[a-z0-9_-]+)', array('methods' => 'GET', 'callback' => $bulk, 'permission_callback' => function () { return current_user_can('edit_posts'); }));
    register_rest_route('bgp/v1', '/acf-schema/(?P<id>\d+)', array('methods' => 'GET', 'callback' => $schema, 'permission_callback' => $can));
    register_rest_route('bgp/v1', '/acf/(?P<id>\d+)', array(
        array('methods' => 'GET', 'callback' => $read, 'permission_callback' => $can),
        array('methods' => 'POST', 'callback' => $write, 'permission_callback' => $can),
    ));
});

// The theme only starts the home page counters (and fade-ins) on the
// "splash-run" event, which the splash video fires as it exits. With the
// splash switched off (Oct 2026) nothing fired it, so the numbers sat at 0.
add_action('wp_footer', function () {
    ?><script>window.addEventListener('load',function(){if(!window.splashData&&window.jQuery){document.body.classList.add('splash-run');jQuery(window).trigger('splash-run');}});</script><?php
}, 100);
